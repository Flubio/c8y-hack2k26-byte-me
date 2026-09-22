import { Component, ElementRef, ViewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { AlertService } from "@c8y/ngx-components";
import { PrototypeEditorService } from "./prototype-editor.service";

@Component({
  selector: "t3k-prototype-editor",
  templateUrl: "./prototype-editor.component.html",
  imports: [FormsModule],
})
export class PrototypeEditorComponent {
  @ViewChild("editorDialog") editorDialog!: ElementRef<HTMLDialogElement>;

  prompt = "";
  isSaving = false;

  constructor(
    private prototypeEditorService: PrototypeEditorService,
    private alertService: AlertService,
  ) {}

  openEditor() {
    this.editorDialog.nativeElement.showModal();
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
