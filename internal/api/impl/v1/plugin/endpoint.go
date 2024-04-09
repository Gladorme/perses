// Copyright 2021 The Perses Authors
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

package plugin

import (
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/perses/perses/internal/api/interface/v1/plugin"
	"github.com/perses/perses/internal/api/route"
	v1 "github.com/perses/perses/pkg/model/api/v1"
	"github.com/perses/perses/pkg/model/api/v1/common"
)

// Endpoint is the struct that define all endpoint delivered by the path /plugin
type endpoint struct {
	service plugin.Service
}

// NewEndpoint create an instance of the object Endpoint.
// You should have at most one instance of this object as it is only used by the struct api in the method api.registerRoute
func NewEndpoint(service plugin.Service) route.Endpoint {
	return &endpoint{
		service: service,
	}
}

// CollectRoutes is the method to use to register the routes prefixed by /api
// If the version is not v1, then look at the same method but in the package with the version as the name.
func (e *endpoint) CollectRoutes(g *route.Group) {
	g.GET("/plugins", e.List, true)
}

func (e *endpoint) List(ctx echo.Context) error {
	return ctx.JSON(http.StatusOK, []ModuleResource{
		{
			Kind: "PluginModule",
			Metadata: v1.Metadata{
				Name: "MyPlugin",
			},
			Spec: ModuleSpec{
				Import: "@test/my-plugin",
				Plugins: []Metadata{
					{
						PluginType: "Variable",
						Kind:       "MyVariable",
						Display: common.Display{
							Name:        "Coucou",
							Description: "",
						},
					},
				},
			},
		},
		{
			Kind: "PluginModule",
			Metadata: v1.Metadata{
				Name: "Prometheus",
			},
			Spec: ModuleSpec{
				Import: "@perses-dev/prometheus-plugin",
				Plugins: []Metadata{
					{
						PluginType: "Variable",
						Kind:       "StaticListVariable",
						Display: common.Display{
							Name:        "[Static] Custom List",
							Description: "Static list variables allow you to define an array of values",
						},
					},
					{
						PluginType: "Variable",
						Kind:       "PrometheusLabelValuesVariable",
						Display: common.Display{
							Name:        "[Prometheus] Label Values",
							Description: "",
						},
					},
					{
						PluginType: "Variable",
						Kind:       "PrometheusLabelNamesVariable",
						Display: common.Display{
							Name:        "[Prometheus] Label Names",
							Description: "",
						},
					},
					{
						PluginType: "Variable",
						Kind:       "PrometheusPromQLVariable",
						Display: common.Display{
							Name:        "[Prometheus] PromQL Result Values",
							Description: "",
						},
					},
					{
						PluginType: "TimeSeriesQuery",
						Kind:       "PrometheusTimeSeriesQuery",
						Display: common.Display{
							Name:        "Prometheus Range Query",
							Description: "",
						},
					},
					{
						PluginType: "Datasource",
						Kind:       "PrometheusDatasource",
						Display: common.Display{
							Name:        "Prometheus Datasource",
							Description: "",
						},
					},
				},
			},
		},
	})
}

type ModuleResource struct {
	Kind     string      `json:"kind"`
	Metadata v1.Metadata `json:"metadata"`
	Spec     ModuleSpec  `json:"spec"`
}

type ModuleSpec struct {
	Plugins []Metadata `json:"plugins"`
	Import  string     `json:"import"`
}

type Metadata struct {
	PluginType string         `json:"pluginType"`
	Kind       string         `json:"kind"`
	Display    common.Display `json:"display"`
}
