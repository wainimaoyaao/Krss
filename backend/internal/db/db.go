package db

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"

	"krss/backend/pkg/logger"
)

// 数据目录与库文件的权限（S5）。
//
// 这个库里是订阅列表、已读/星标状态、AI 与 MCP 凭证、插件数据 —— 单用户自托管没有理由
// 让同一台机器上的其它用户读到。以前 `MkdirAll` 用的是 0755，库文件则完全交给 umask。
//
// 现在：新建目录 0700；已存在的目录/库文件如果对 group 或 other 开了任何权限位就收紧，
// 并在日志里说明收紧前是什么。收紧失败不影响启动（只告警），因为某些部署把数据目录放在
// 共享卷上，chmod 可能被拒绝，此时按部署自己的权限策略走。
const (
	dataDirPerm  os.FileMode = 0o700
	dataFilePerm os.FileMode = 0o600
)

func Open(path string) (*sql.DB, error) {
	dir := filepath.Dir(path)
	if dir != "." {
		if err := os.MkdirAll(dir, dataDirPerm); err != nil {
			return nil, fmt.Errorf("create db dir: %w", err)
		}
		tightenPerm(dir, dataDirPerm, "data dir", true)
	}

	// Build DSN with pragmas to ensure all connections in the pool have them
	dsn := buildDSN(path)

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	if err := Migrate(db); err != nil {
		_ = db.Close()
		return nil, err
	}

	// 库文件和 WAL/SHM 伴随文件这时已经有了，一起收紧。
	for _, f := range []string{path, path + "-wal", path + "-shm"} {
		// 库文件是 SQLite 按 umask 建的（默认 0644），首次启动收紧属于正常路径，
		// 用 info 记一笔就够；目录那次才算「旧部署遗留」，用 warn。
		tightenPerm(f, dataFilePerm, "database file", false)
	}

	return db, nil
}

// buildDSN constructs a SQLite DSN with pragmas embedded.
// This ensures all connections in the pool have the same settings.
func buildDSN(path string) string {
	params := url.Values{}
	params.Add("_pragma", "journal_mode(WAL)")
	params.Add("_pragma", "foreign_keys(ON)")
	params.Add("_pragma", "busy_timeout(30000)")
	params.Add("_pragma", "synchronous(NORMAL)")
	return fmt.Sprintf("file:%s?%s", path, params.Encode())
}

// tightenPerm 把 target 的权限收紧到 perm：本来就够紧就不动，比 perm 宽就 chmod 并告警，
// 失败也只告警（共享卷等部署可能不允许改权限）。
func tightenPerm(target string, perm os.FileMode, what string, loud bool) {
	info, err := os.Stat(target)
	if err != nil {
		return // 文件还没建（例如 WAL 尚未生成），没什么可收紧的
	}
	current := info.Mode().Perm()
	if current&^perm == 0 {
		return
	}
	if err := os.Chmod(target, perm); err != nil {
		logger.Warn("data permission not tightened", "what", what, "path", target, "mode", fmt.Sprintf("%04o", current), "error", err)
		return
	}
	if loud {
		logger.Warn("data permission tightened", "what", what, "path", target, "from", fmt.Sprintf("%04o", current), "to", fmt.Sprintf("%04o", perm))
		return
	}
	logger.Info("data permission tightened", "what", what, "path", target, "from", fmt.Sprintf("%04o", current), "to", fmt.Sprintf("%04o", perm))
}
