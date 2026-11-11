// Copyright The Perses Authors
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

package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/gorilla/securecookie"
	"github.com/labstack/echo/v5"
	"github.com/perses/perses/internal/api/utils"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/oauth2"
)

func TestGetRedirectURI_WithAPIPrefix(t *testing.T) {
	cases := []struct {
		title     string
		apiPrefix string
		want      string
	}{
		{"empty prefix", "", "http://localhost:8080/api/auth/providers/oidc/azure/callback"},
		{"perses", "perses", "http://localhost:8080/perses/api/auth/providers/oidc/azure/callback"},
		{"/perses", "/perses", "http://localhost:8080/perses/api/auth/providers/oidc/azure/callback"},
		// Double slashes are not removed, but it's ok as the apiPrefix supposed to be used as is.
		{"perses/", "perses/", "http://localhost:8080/perses//api/auth/providers/oidc/azure/callback"},
	}
	for _, tc := range cases {
		t.Run(tc.title, func(t *testing.T) {
			got := getRedirectURI(&http.Request{
				URL: &url.URL{
					Scheme: "http",
				},
				Host: "localhost:8080",
			}, utils.AuthnKindOIDC, "azure", tc.apiPrefix)
			assert.Equal(t, tc.want, got)
		})
	}
}

// Test for encodeOAuthState: ensures the state is correctly formatted and contains the redirect path.
func TestEncodeOAuthState(t *testing.T) {
	redirect := "/dashboard"
	state := encodeOAuthState(redirect)
	assert.Contains(t, state, "--/dashboard")
	assert.Len(t, state, 16+2+10)
}

// Test for decodeOAuthState: ensures correct extraction and empty string for invalid formats.
func TestDecodeOAuthState(t *testing.T) {
	redirect := "/dashboard"
	state := "1234567890abcdef--" + redirect
	assert.Equal(t, redirect, decodeOAuthState(state))

	state = "invalidformat"
	assert.Equal(t, "", decodeOAuthState(state))

	state = "short--"
	assert.Equal(t, "", decodeOAuthState(state))
}

func TestSanitizeRedirectPath(t *testing.T) {
	testSuite := []struct {
		title        string
		redirectPath string
		apiPrefix    string
		expected     string
	}{
		{title: "empty path falls back to the root", redirectPath: "", expected: "/"},
		{title: "empty path falls back to the api prefix", redirectPath: "", apiPrefix: "/perses", expected: "/perses"},
		{title: "root path", redirectPath: "/", expected: "/"},
		{title: "local path", redirectPath: "/projects/perses/dashboards/demo", expected: "/projects/perses/dashboards/demo"},
		{title: "local path under the api prefix", redirectPath: "/perses/projects/perses", apiPrefix: "/perses", expected: "/perses/projects/perses"},
		{title: "local path with a query", redirectPath: "/projects/perses/dashboards/demo?var-job=node&start=1h", expected: "/projects/perses/dashboards/demo?var-job=node&start=1h"},
		{title: "local path with a fragment", redirectPath: "/projects/perses#section", expected: "/projects/perses#section"},
		{title: "absolute URL inside a query value is kept", redirectPath: "/explore?link=https://example.com/", expected: "/explore?link=https://example.com/"},
		{title: "backslash inside a query value is kept", redirectPath: `/explore?filter=a\.b`, expected: `/explore?filter=a\.b`},
		{title: "percent-encoded slash is kept", redirectPath: "/projects/a%2Fb", expected: "/projects/a%2Fb"},
		{title: "absolute URL", redirectPath: "https://example.com/", expected: "/"},
		{title: "absolute URL falls back to the api prefix", redirectPath: "https://example.com/", apiPrefix: "/perses", expected: "/perses"},
		{title: "absolute URL without path", redirectPath: "http://example.com", expected: "/"},
		{title: "scheme-relative URL", redirectPath: "//example.com/path", expected: "/"},
		{title: "backslash after the leading slash", redirectPath: `/\example.com`, expected: "/"},
		{title: "leading backslashes", redirectPath: `\\example.com`, expected: "/"},
		{title: "backslash in the path", redirectPath: `/projects\perses`, expected: "/"},
		{title: "relative path", redirectPath: "projects/perses", expected: "/"},
		{title: "other scheme", redirectPath: "mailto:someone@example.com", expected: "/"},
		{title: "tab character", redirectPath: "/\t/example.com", expected: "/"},
		{title: "new line character", redirectPath: "/projects\n/perses", expected: "/"},
		{title: "leading space", redirectPath: " /projects/perses", expected: "/"},
	}
	for _, test := range testSuite {
		t.Run(test.title, func(t *testing.T) {
			assert.Equal(t, test.expected, sanitizeRedirectPath(test.redirectPath, test.apiPrefix))
		})
	}
}

// TestOAuthAuthHandler_SanitizesRedirectPath ensures that a redirect path leading to another website
// is not kept in the state sent to the provider.
func TestOAuthAuthHandler_SanitizesRedirectPath(t *testing.T) {
	testSuite := []struct {
		title            string
		redirectPath     string
		expectedRedirect string
	}{
		{title: "local path is kept", redirectPath: "/projects/perses", expectedRedirect: "/projects/perses"},
		{title: "scheme-relative URL is replaced", redirectPath: "//example.com/path", expectedRedirect: "/"},
		{title: "absolute URL is replaced", redirectPath: "https://example.com/", expectedRedirect: "/"},
	}
	for _, test := range testSuite {
		t.Run(test.title, func(t *testing.T) {
			key := securecookie.GenerateRandomKey(16)
			endpoint := &oAuthEndpoint{
				conf: oauth2.Config{
					ClientID:    "client-id",
					RedirectURL: "https://perses.example.com/api/auth/providers/oauth/test/callback",
					Endpoint:    oauth2.Endpoint{AuthURL: "https://provider.example.com/authorize"},
				},
				secureCookie: securecookie.New(key, key),
				slugID:       "test",
			}

			e := echo.New()
			req := httptest.NewRequest(http.MethodGet, "/api/auth/providers/oauth/test/login?rd="+url.QueryEscape(test.redirectPath), nil)
			rec := httptest.NewRecorder()
			ctx := e.NewContext(req, rec)

			require.NoError(t, endpoint.authHandler(ctx))
			assert.Equal(t, http.StatusFound, rec.Code)

			location, err := url.Parse(rec.Header().Get("Location"))
			require.NoError(t, err)
			assert.Equal(t, test.expectedRedirect, decodeOAuthState(location.Query().Get("state")))
		})
	}
}

// TestOAuthRetrieveDeviceAccessToken_UsesProviderHTTPClient ensures the device code token
// exchange goes through the provider-scoped http client (which carries the configured TLS
// and timeout) rather than http.DefaultClient. The server is served over TLS with a test
// certificate that only the provider client trusts, so the exchange can only succeed when
// e.httpClient is used.
func TestOAuthRetrieveDeviceAccessToken_UsesProviderHTTPClient(t *testing.T) {
	const deviceCode = "device-code-123"
	var gotGrantType, gotDeviceCode string
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.NoError(t, r.ParseForm())
		gotGrantType = r.PostForm.Get("grant_type")
		gotDeviceCode = r.PostForm.Get("device_code")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"an-access-token","token_type":"Bearer"}`))
	}))
	defer srv.Close()

	e := &oAuthEndpoint{
		// srv.Client() trusts the server's test certificate, unlike http.DefaultClient.
		httpClient: srv.Client(),
		deviceCodeConf: oauth2.Config{
			Endpoint: oauth2.Endpoint{TokenURL: srv.URL},
		},
	}

	token, err := e.retrieveDeviceAccessToken(context.Background(), deviceCode)
	require.NoError(t, err)
	assert.Equal(t, "an-access-token", token.AccessToken)
	assert.Equal(t, "urn:ietf:params:oauth:grant-type:device_code", gotGrantType)
	assert.Equal(t, deviceCode, gotDeviceCode)
}
