package ama

import "net/http"

type Client struct {
	Origin      string
	AccessToken string
	ProjectID   string
	HTTPClient  *http.Client
}
