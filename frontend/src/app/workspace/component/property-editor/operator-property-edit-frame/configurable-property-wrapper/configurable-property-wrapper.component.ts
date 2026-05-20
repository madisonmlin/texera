import { Component } from "@angular/core";
import {FieldWrapper, FormlyFieldConfig} from "@ngx-formly/core";
import {merge} from "lodash";
import {PresetKey} from "../../../../../common/formly/preset-wrapper/preset-wrapper.component";

@Component({
  selector: "texera-configurable-property-wrapper",
  templateUrl: "./configurable-property-wrapper.component.html",
  styleUrls: ["./configurable-property-wrapper.component.scss"],
})
export class ConfigurablePropertyWrapperComponent extends FieldWrapper {
  public static setupFieldConfig(
    config: FormlyFieldConfig,
    isTemplateMode: boolean,
    configurable: boolean,
    toggleFn: (event: Event) => void,
    includePresetWrapper: boolean = false,
  ) {
    const fieldConfig: FormlyFieldConfig = {
      wrappers: includePresetWrapper
      ? ["form-field", "preset-wrapper", "configurable-property-wrapper"]
      : ["form-field", "configurable-property-wrapper"],
      props: {
        ...config.props,

        isTemplateMode,
        configurable,
        toggleConfigurable: toggleFn,
      },
    };
    merge(config, fieldConfig);
  }
}
