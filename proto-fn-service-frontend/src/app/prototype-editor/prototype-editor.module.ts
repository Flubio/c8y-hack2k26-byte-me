import { EnvironmentInjector, Injectable, NgModule } from "@angular/core";
import {
  DynamicWidgetDefinition,
  ExtensionFactory,
  hookWidget,
} from "@c8y/ngx-components";
import { gettext } from "@c8y/ngx-components/gettext";

import { PrototypeEditorComponent } from "./prototype-editor.component";

export const prototypeEditorWidgetDefinition = {
  id: "prototype-editor.widget",
  label: gettext("Prototype Editor"),
  description: gettext("Create an prototype for a microservice."),
  component: PrototypeEditorComponent,
  data: {
    settings: {
      noNewWidgets: false,
    },
  },
} satisfies DynamicWidgetDefinition;

@Injectable({ providedIn: "root" })
export class PrototypeEditorWidgetFactory implements ExtensionFactory<DynamicWidgetDefinition> {
  constructor(private injector: EnvironmentInjector) {}

  get(): DynamicWidgetDefinition {
    return {
      ...prototypeEditorWidgetDefinition,
      injector: this.injector,
    };
  }
}

export const prototypeEditorProviders = [
  hookWidget(PrototypeEditorWidgetFactory),
];

@NgModule({
  imports: [PrototypeEditorComponent],
  providers: [...prototypeEditorProviders],
})
export class PrototypeEditorModule {}
