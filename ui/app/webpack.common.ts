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

import path from 'path';
import fs from 'fs';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import { Configuration } from 'webpack';
import ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import ESLintWebpackPlugin from 'eslint-webpack-plugin';
import CircularDependencyPlugin from 'circular-dependency-plugin';
import { defineReactCompilerLoaderOption, reactCompilerLoader } from 'react-compiler-webpack';

// Use common config for swc
const swcrc = JSON.parse(fs.readFileSync('../.swcrc', 'utf-8'));

export const commonConfig: Configuration = {
  entry: path.resolve(__dirname, './src/bundle.ts'),
  output: {
    path: path.resolve(__dirname, './dist'),
    publicPath: '/',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', 'jsx', '.json'],
  },
  plugins: [
    // Generates HTML index page with bundle injected
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, './src/index.html'),
      templateParameters: {},
      favicon: './src/favicon.ico',
    }),
    // Does TS type-checking in a separate process
    new ForkTsCheckerWebpackPlugin({
      typescript: {
        configFile: path.resolve(__dirname, './tsconfig.json'),
      },
    }),
    new ESLintWebpackPlugin({
      threads: true,
      files: '../*/src/**/*.{ts,tsx,js,jsx}',
    }),
    new CircularDependencyPlugin({
      exclude: /node_modules/,
      failOnError: true,
    }),
  ],
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: [
          // babel-loader, swc-loader, esbuild-loader, or anything you like to transpile JSX should go here.
          // If you are using rspack, the rspack's buiilt-in react transformation is sufficient.
          { loader: 'swc-loader', options: swcrc },
          // Now add forgetti-loader
          {
            loader: reactCompilerLoader,
            options: defineReactCompilerLoaderOption({
              // React Compiler options goes here
            }),
          },
        ],
      },

      // {
      //   test: /\.[mc]?[jt]sx$/i,
      //   exclude: /node_modules/,
      //   use: [
      //     // babel-loader, swc-loader, esbuild-loader, or anything you like to transpile JSX should go here.
      //     // If you are using rspack, the rspack's buiilt-in react transformation is sufficient.
      //     { loader: 'swc-loader' },
      //     // Now add forgetti-loader
      //     {
      //       loader: reactCompilerLoader,
      //       options: defineReactCompilerLoaderOption({
      //         // React Compiler options goes here
      //       }),
      //     },
      //   ],
      // },
      // {
      //   test: /\.tsx?$/,
      //   use: [
      //     {
      //       // Type-checking happens in separate plugin process
      //       loader: 'swc-loader',
      //       options: swcrc,
      //     },
      //   ],
      // },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.(ttf|eot|woff|woff2)$/,
        type: 'asset/resource',
      },
      {
        test: /\.(png|jpg|gif)$/,
        type: 'asset',
      },
      // SVG as React components
      {
        test: /\.svg$/,
        use: [
          {
            loader: '@svgr/webpack',
            options: {
              // Generated React components will support a 'title' prop to render
              // a <title> inside the <svg>
              titleProp: true,
            },
          },
        ],
      },
    ],
  },
};
