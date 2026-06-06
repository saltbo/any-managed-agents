package main

func initialPrompt(payload WorkPayload) string {
	if payload.InitialPrompt == nil {
		return ""
	}
	return *payload.InitialPrompt
}
