import { Component, ElementRef, ViewChild } from "@angular/core";
import { NgFor } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { AlertService } from "@c8y/ngx-components";
import byteMeLogo from "../../assets/byte-me-logo.png";
import { PrototypeEditorService } from "./prototype-editor.service";

@Component({
  selector: "t3k-prototype-editor",
  templateUrl: "./prototype-editor.component.html",
  styleUrl: "./prototype-editor.component.less",
  imports: [FormsModule, NgFor],
})
export class PrototypeEditorComponent {
  @ViewChild("editorDialog") editorDialog!: ElementRef<HTMLDialogElement>;

  readonly byteMeLogo = byteMeLogo;

  prompt = "";
  isSaving = false;

  readonly promptSuggestions = [
    "Create a device health microservice with an HTTP endpoint and status checks.",
    "Build a data processor that validates incoming measurements and reports errors.",
    "Create a scheduled service that summarizes daily device activity.",
  ];

  constructor(
    private prototypeEditorService: PrototypeEditorService,
    private alertService: AlertService,
  ) {}

  openEditor() {
    this.editorDialog.nativeElement.showModal();
  }

  useSuggestion(suggestion: string) {
    if (!this.isSaving) {
      this.prompt = suggestion;
    }
  }

  handleDialogClick(event: MouseEvent) {
    if (event.target === this.editorDialog.nativeElement && !this.isSaving) {
      this.closeEditor();
    }
  }

  async save() {
    const prompt = this.prompt.trim();
    if (!prompt || this.isSaving) {
      return;
    }

    this.isSaving = true;
    try {
      await this.prototypeEditorService.createPrototype(prompt);
      this.alertService.success("Prototype created.");
      this.closeEditor();
    } catch (error) {
      console.error("Unable to create prototype:", error);
      this.alertService.danger("Unable to create the prototype.");
    } finally {
      this.isSaving = false;
    }
  }

  closeEditor() {
    this.editorDialog.nativeElement.close();
  }
}
