package tokens

func Issue(userID string) string {
	return "tok-" + userID
}

func Verify(token string) bool {
	return len(token) > 0
}
