import {
  DefinitionProvider,
  TextDocument,
  Position,
  CancellationToken,
  ProviderResult,
  Definition,
  DefinitionLink,
  Location,
  Uri,
  Disposable,
} from "vscode";
import { readFileSync } from "fs";
import { isEnclosedWithinCodeBlock } from "../utils";
import { SourceMetaMap } from "../domain";
import { dbtProjectContainer } from "../manifest/dbtProjectContainer";
import { ManifestCacheChangedEvent } from "../manifest/event/manifestCacheChangedEvent";

export class SourceDefinitionProvider
  implements DefinitionProvider, Disposable {
  private sourceMetaMap: Map<string, SourceMetaMap> = new Map();
  private static readonly IS_SOURCE = /(source)\([^)]*\)/;
  private static readonly GET_SOURCE_INFO = /(?!['"])(\w+)(?=['"])/g;
  private disposables: Disposable[] = [];

  constructor() {
    this.disposables.push(
      dbtProjectContainer.onManifestChanged((event) =>
        this.onManifestCacheChanged(event)
      )
    );
  }

  dispose() {
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  provideDefinition(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): ProviderResult<Definition | DefinitionLink[]> {
    return new Promise((resolve, reject) => {
      const hover = document.getText(document.getWordRangeAtPosition(position));
      const range = document.getWordRangeAtPosition(
        position,
        SourceDefinitionProvider.IS_SOURCE
      );
      const word = document.getText(range);

      const linePrefix = document
        .lineAt(position)
        .text.substr(0, position.character);

      if (
        !isEnclosedWithinCodeBlock(document, position) ||
        !linePrefix.includes("source") ||
        hover === "source"
      ) {
        reject();
        return;
      }

      const source = word.match(SourceDefinitionProvider.GET_SOURCE_INFO);
      if (source === null || source === undefined) {
        reject();
        return;
      }
      const definition = this.getSourceDefinition(
        source[0],
        document.uri,
        source.length > 1 && hover === source[1] ? source[1] : undefined
      );
      resolve(definition);
    });
  }

  private onManifestCacheChanged(event: ManifestCacheChangedEvent): void {
    event.added?.forEach((added) => {
      this.sourceMetaMap.set(added.projectRoot.fsPath, added.sourceMetaMap);
    });
    event.removed?.forEach((removed) => {
      this.sourceMetaMap.delete(removed.projectRoot.fsPath);
    });
  }

  private getSourceDefinition(
    sourceName: string,
    currentFilePath: Uri,
    tableName?: string
  ): Definition | undefined {
    const projectRootpath = dbtProjectContainer.getProjectRootpath(
      currentFilePath
    );
    if (projectRootpath === undefined) {
      return;
    }
    const sourceMap = this.sourceMetaMap.get(projectRootpath.fsPath);
    if (sourceMap === undefined) {
      return;
    }
    const location = sourceMap.get(sourceName);
    if (location) {
      const sourceFile: string = readFileSync(location.path).toString("utf8");
      const sourceFileLines = sourceFile.split("\n");
      const lookupItem = tableName || sourceName;

      for (let index = 0; index < sourceFileLines.length; index++) {
        const currentLine = sourceFileLines[index];
        if (currentLine.includes(lookupItem)) {
          return new Location(
            Uri.file(location.path),
            new Position(index, currentLine.indexOf(lookupItem))
          );
        }
      }
    }
    return undefined;
  }
}
