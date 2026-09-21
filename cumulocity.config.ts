import type { ConfigurationOptions } from '@c8y/devkit';
import { description, version } from './package.json';

export default {
  runTime: {
    description,
    version,
    name: 'Prototype Editor plugin',
    contentSecurityPolicy:
      "base-uri 'none'; default-src 'self' 'unsafe-inline' http: https: ws: wss:; connect-src 'self' http: https: ws: wss:;  script-src 'self' *.bugherd.com *.twitter.com *.twimg.com *.aptrinsic.com 'unsafe-inline' 'unsafe-eval' data:; style-src * 'unsafe-inline' blob:; img-src * data: blob:; font-src * data:; frame-src *; worker-src 'self' blob:;",
    dynamicOptionsUrl: true,
    remotes: {
      'prototype-editor': ['PrototypeEditorModule'],
    },
    contextPath: 'prototype-editor-plugin',
    key: 'prototype-editor-plugin-application-key',
    package: 'plugin',
    isPackage: true,
    noAppSwitcher: true,
    license: 'MIT',
    exports: [
      {
        name: 'Prototype Editor plugin',
        module: 'PrototypeEditorModule',
        path: './src/app/prototype-editor/prototype-editor.module.ts',
        readmePath: './README.md',
        description:
          'Adds the Prototype Editor to device pages in Cockpit and Device Management.',
      },
    ],
  },
  buildTime: {
    federation: [
      '@angular/animations',
      '@angular/cdk',
      '@angular/common',
      '@angular/compiler',
      '@angular/core',
      '@angular/forms',
      '@angular/platform-browser',
      '@angular/platform-browser-dynamic',
      '@angular/router',
      '@angular/upgrade',
      '@c8y/client',
      '@c8y/ngx-components',
      '@ngx-translate/core',
      '@ngx-formly/core',
    ],
  },
} as const satisfies ConfigurationOptions;
