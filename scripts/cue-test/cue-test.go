// Copyright 2022 The Perses Authors
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

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/perses/perses/internal/api/config"
	"github.com/perses/perses/internal/api/shared/schemas"
	"github.com/perses/perses/pkg/model/api/v1/common"
	"github.com/sirupsen/logrus"
)

type validateFunc func(plugin common.Plugin, name string) error

func validateSchemas(folder string, vf validateFunc) {
	logrus.Infof("validate schemas under %q", folder)
	dirEntries, err := os.ReadDir(folder)
	if err != nil {
		logrus.Fatal(err)
	}
	for _, dir := range dirEntries {
		data, readErr := os.ReadFile(filepath.Join(folder, dir.Name(), fmt.Sprintf("%s.json", dir.Name())))
		if readErr != nil {
			logrus.Fatal(readErr)
		}
		plugin := &common.Plugin{}
		if jsonErr := json.Unmarshal(data, plugin); jsonErr != nil {
			logrus.Fatal(jsonErr)
		}
		if validateErr := vf(*plugin, dir.Name()); validateErr != nil {
			logrus.Fatal(validateErr)
		}
	}
}

func main() {
	cfg := config.Schemas{}
	_ = cfg.Verify()
	sch := schemas.New(cfg)
	for _, loader := range sch.GetLoaders() {
		if err := loader.Load(); err != nil {
			logrus.Fatal(err)
		}
	}
	validateSchemas(config.DefaultPanelsPath, func(plugin common.Plugin, name string) error {
		return sch.ValidatePanel(plugin, name)
	})
	validateSchemas(config.DefaultDatasourcesPath, func(plugin common.Plugin, _ string) error {
		return sch.ValidateDatasource(plugin)
	})
}