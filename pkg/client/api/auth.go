// Copyright 2023 The Perses Authors
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package api

import (
	"fmt"
	"net/url"

	"github.com/perses/perses/pkg/client/perseshttp"
	"github.com/perses/perses/pkg/model/api"
)

const authResource = "auth"

type DeviceCodeResponse struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURL string `json:"verification_uri"`
	ExpiresIn       int    `json:"expires_in"`
	Interval        int    `json:"interval"`
}

type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
}

// AuthInterface has methods to work with Auth resource
type AuthInterface interface {
	StartDeviceCodeFlow(authKind, authProvider, clientID string) (*DeviceCodeResponse, error)
	PollDeviceCodeFlow(authKind, slugID, clientID, deviceCode string) (*TokenResponse, error)
	Login(user, password string) (*api.AuthResponse, error)
	Refresh(refreshToken string) (*api.AuthResponse, error)
}

func newAuth(client *perseshttp.RESTClient) AuthInterface {
	return &auth{client: client}
}

// auth implements AuthInterface
type auth struct {
	AuthInterface
	client *perseshttp.RESTClient
}

func (c *auth) Login(user string, password string) (*api.AuthResponse, error) {
	body := &api.Auth{
		Login:    user,
		Password: password,
	}
	result := &api.AuthResponse{}

	return result, c.client.Post().
		APIVersion("").
		Resource(fmt.Sprintf("%s/%s", authResource, "providers/native/login")).
		Body(body).
		Do().
		Object(result)
}

func (c *auth) Refresh(refreshToken string) (*api.AuthResponse, error) {
	body := &api.RefreshRequest{RefreshToken: refreshToken}
	result := &api.AuthResponse{}

	return result, c.client.Post().
		APIVersion("").
		Resource(fmt.Sprintf("%s/refresh", authResource)).
		Body(body).
		Do().
		Object(result)
}

func (c *auth) StartDeviceCodeFlow(authKind, slugID, clientID string) (*DeviceCodeResponse, error) {
	result := &DeviceCodeResponse{}

	err := c.client.Post().
		APIVersion("").
		Resource(fmt.Sprintf("%s/providers/%s/%s/device/code", authResource, authKind, slugID)).
		Body(url.Values{"client_id": {clientID}, "scope": {"profile"}}).
		Do().
		Object(result)

	if err != nil {
		return nil, err
	}

	return result, nil
}

func (c *auth) PollDeviceCodeFlow(authKind, slugID, clientID, deviceCode string) (*TokenResponse, error) {
	result := &TokenResponse{}
	err := c.client.Post().
		APIVersion("").
		Resource(fmt.Sprintf("%s/providers/%s/%s/token", authResource, authKind, slugID)).
		Body(map[string]string{"client_id": clientID, "device_code": deviceCode}).
		Do().
		Object(result)
	return result, err
}
