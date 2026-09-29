export class SelectedPathAuthorizer {
  private readonly selectedPaths = new Set<string>();

  public authorize(path: string): void {
    this.selectedPaths.add(path);
  }

  public consume(path: string): boolean {
    if (!this.selectedPaths.has(path)) return false;
    this.selectedPaths.delete(path);
    return true;
  }
}
