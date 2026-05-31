package ama

import "net/http"

type Client struct {
	Origin      string
	AccessToken string
	HTTPClient  *http.Client
}
