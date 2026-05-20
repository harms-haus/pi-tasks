import { vi } from "vitest";

/** Mock Text class for testing */
class MockText {
  constructor(
    private _text: string,
    _x: number,
    _y: number,
  ) {}

  toString(): string {
    return this._text;
  }

  render(_width: number): string[] {
    if (this._text === "") {
      return [];
    }
    return this._text.split("\n");
  }
}

// Mock the Text class globally
vi.mock("@earendil-works/pi-tui", () => ({
  Text: MockText,
}));
