package service

import (
	"mime"
	"net/url"
	"strings"

	"github.com/mmcdole/gofeed"
)

// extractPlayableMedia picks the first typed audio/video enclosure, then falls
// back to Media RSS content. It does not fetch URLs; playback goes through the
// existing proxy, which applies its own outbound policy.
func extractPlayableMedia(item *gofeed.Item) (*string, *string) {
	for _, enclosure := range item.Enclosures {
		if enclosure != nil {
			if mediaURL, mediaType := playableAttachment(enclosure.URL, enclosure.Type); mediaURL != nil {
				return mediaURL, mediaType
			}
		}
	}
	media := item.Extensions["media"]
	for _, content := range media["content"] {
		if mediaURL, mediaType := playableAttachment(content.Attrs["url"], content.Attrs["type"]); mediaURL != nil {
			return mediaURL, mediaType
		}
	}
	for _, group := range media["group"] {
		for _, content := range group.Children["content"] {
			if mediaURL, mediaType := playableAttachment(content.Attrs["url"], content.Attrs["type"]); mediaURL != nil {
				return mediaURL, mediaType
			}
		}
	}
	return nil, nil
}

func playableAttachment(rawURL, rawType string) (*string, *string) {
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(rawType))
	if err != nil || (!strings.HasPrefix(mediaType, "audio/") && !strings.HasPrefix(mediaType, "video/")) {
		return nil, nil
	}
	subtype := strings.SplitN(mediaType, "/", 2)[1]
	if subtype == "" || subtype == "*" {
		return nil, nil
	}
	mediaURL := strings.TrimSpace(rawURL)
	u, err := url.Parse(mediaURL)
	if err != nil || u.Hostname() == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, nil
	}
	return &mediaURL, &mediaType
}
