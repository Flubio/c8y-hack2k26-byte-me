import { Injectable } from "@angular/core";
import { IManagedObject, InventoryService, FetchClient } from "@c8y/client";

@Injectable({ providedIn: "root" })
export class PrototypeEditorService {
  public constructor(
    private fetchClient: FetchClient,
    private inventoryService: InventoryService,
  ) {}

  async createPrototype(prompt: string): Promise<IManagedObject> {
    console.log(prompt);
    /**
      const created = await this.inventoryService.create({
        name: "AI prototype",
        c8y_Prototype: {
          prompt,
        },
      });
    */
    const response = await this.fetchClient.fetch(
      `/service/ai/agent/text/xxxxxxx`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              content: `${prompt}`,
              role: "user",
            },
          ],
        }),
      },
    );

    try {
      console.log(response);
      if (!response.ok) {
        console.error(
          "HTTP Error Status:",
          response.status,
          response.statusText,
        );
        throw new Error(
          `HTTP Error: ${response.status} ${response.statusText}`,
        );
      }
      return response.json();
    } catch (error) {
      console.error("Error in prototype editor service:", error);
      console.error("Response Status Code:", response.status);
      throw error;
    }
  }
}
