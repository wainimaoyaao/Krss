package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"
)

func parseIDParam(c echo.Context, name string) (int64, error) {
	return strconv.ParseInt(c.Param(name), 10, 64)
}

// isValidContentType 内容类型白名单。
//
// 2026-11-26 起六档：在原来的 article / picture / notification / social 之后加了
// video / audio —— 视频源与播客源该有自己的分类，不该挤进「文章」。
// 类型是 feeds / folders 表里的字符串列（无 CHECK 约束、也没有迁移），所以放行新值
// 不需要动库；条目列表按类型过滤走 `f.type = ?`（entry_repository.go:199），任意值天然可查。
//
// 单一来源：handler 里几处（条目列表 query、条目请求体、订阅与文件夹改类型）都调它。
func isValidContentType(t string) bool {
	switch t {
	case "article", "picture", "notification", "social", "video", "audio":
		return true
	default:
		return false
	}
}
