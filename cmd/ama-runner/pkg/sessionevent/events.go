package sessionevent

// IsCanonicalEventType reports whether t is a known canonical event type.
func IsCanonicalEventType(t string) bool {
	return AmaSessionEventType(t).Valid()
}
