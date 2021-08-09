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

import { Component, OnInit } from '@angular/core';
import { ThemeService } from '../../shared/service/theme.service';
import { Observable } from 'rxjs';
import { OverlayContainer } from '@angular/cdk/overlay';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';

const darkThemeClass = 'perses-dark-theme';

@UntilDestroy()
@Component({
  selector: 'app-template',
  templateUrl: './template.component.html',
  styleUrls: ['./template.component.scss']
})
export class TemplateComponent implements OnInit {
  isDarkTheme: Observable<boolean> = new Observable<boolean>();

  constructor(private readonly themeService: ThemeService,
              private readonly overlayContainer: OverlayContainer) {
  }

  ngOnInit(): void {
    this.isDarkTheme = this.themeService.darkThemeEnable;
    this.isDarkTheme.pipe(untilDestroyed(this)).subscribe(
      res => {
        if (res) {
          this.overlayContainer.getContainerElement().classList.add(darkThemeClass);
        } else {
          this.overlayContainer.getContainerElement().classList.remove(darkThemeClass);
        }
      });
  }

  toggleDarkTheme(checked: boolean): void {
    this.themeService.enableDarkTheme(checked);
  }

}
