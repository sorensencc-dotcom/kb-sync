import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const COMPACTOR_VERSION = '1.0.0';

if (!ts.version.startsWith('5.4')) {
  throw new Error(`Compactor Engine Error: Pinned typescript@5.4.x required. Found version ${ts.version}`);
}

function getScriptKind(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':  return ts.ScriptKind.TS;
    case '.tsx': return ts.ScriptKind.TSX;
    case '.js':  return ts.ScriptKind.JS;
    case '.jsx': return ts.ScriptKind.JSX;
    case '.mjs': return ts.ScriptKind.JS;
    case '.cjs': return ts.ScriptKind.JS;
    default:     return ts.ScriptKind.TS;
  }
}

function createPlaceholderBlock() {
  return ts.factory.createBlock([
    ts.factory.createThrowStatement(
      ts.factory.createNewExpression(
        ts.factory.createIdentifier('Error'),
        undefined,
        [ts.factory.createStringLiteral('[COMPACTED SKELETON: IMPLEMENTATION STRIPPED - DO NOT EXECUTE]')]
      )
    )
  ], true);
}

export function skeletonizeFile(filePath, relativePath, contentHash, reason) {
  let rawContent;
  try {
    rawContent = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { content: '', state: 'Full', warning: `Read error: ${err.message}` };
  }

  try {
    const scriptKind = getScriptKind(filePath);

    // Fail-Closed Syntactic Diagnostic Gate via Public Compiler API
    const transpileResult = ts.transpileModule(rawContent, {
      compilerOptions: { target: ts.ScriptTarget.Latest, jsx: ts.JsxEmit.Preserve },
      reportDiagnostics: true
    });

    if (transpileResult.diagnostics && transpileResult.diagnostics.length > 0) {
      const diag = transpileResult.diagnostics[0];
      const text = typeof diag.messageText === 'string' ? diag.messageText : diag.messageText.messageText;
      return {
        content: rawContent,
        state: 'Full',
        warning: `Syntactic diagnostic error: "${text}"`
      };
    }

    const sourceFile = ts.createSourceFile(
      filePath,
      rawContent,
      ts.ScriptTarget.Latest,
      true,
      scriptKind
    );

    const transformer = (context) => {
      return (rootNode) => {
        const visit = (node) => {
          if (ts.isFunctionDeclaration(node) && node.body) {
            return ts.factory.updateFunctionDeclaration(
              node, node.modifiers, node.asteriskToken, node.name,
              node.typeParameters, node.parameters, node.type,
              createPlaceholderBlock()
            );
          }
          if (ts.isFunctionExpression(node) && node.body) {
            return ts.factory.updateFunctionExpression(
              node, node.modifiers, node.name, node.typeParameters,
              node.parameters, node.type,
              createPlaceholderBlock()
            );
          }
          if (ts.isMethodDeclaration(node) && node.body) {
            return ts.factory.updateMethodDeclaration(
              node, node.modifiers, node.asteriskToken, node.name,
              node.questionToken, node.typeParameters, node.parameters, node.type,
              createPlaceholderBlock()
            );
          }
          if (ts.isConstructorDeclaration(node) && node.body) {
            return ts.factory.updateConstructorDeclaration(
              node, node.modifiers, node.parameters,
              createPlaceholderBlock()
            );
          }
          if (ts.isGetAccessorDeclaration(node) && node.body) {
            return ts.factory.updateGetAccessorDeclaration(
              node, node.modifiers, node.name, node.parameters, node.type,
              createPlaceholderBlock()
            );
          }
          if (ts.isSetAccessorDeclaration(node) && node.body) {
            return ts.factory.updateSetAccessorDeclaration(
              node, node.modifiers, node.name, node.parameters,
              createPlaceholderBlock()
            );
          }
          if (ts.isArrowFunction(node) && node.body) {
            return ts.factory.updateArrowFunction(
              node, node.modifiers, node.typeParameters, node.parameters, node.type,
              node.equalsGreaterThanToken,
              createPlaceholderBlock()
            );
          }
          return ts.visitEachChild(node, visit, context);
        };
        return ts.visitNode(rootNode, visit);
      };
    };

    let result;
    let skeletonCode;
    try {
      result = ts.transform(sourceFile, [transformer]);
      const printer = ts.createPrinter({ removeComments: false, newLine: ts.NewLineKind.LineFeed });
      skeletonCode = printer.printFile(result.transformed[0]);
    } finally {
      if (result) result.dispose();
    }

    const banner = generateProvenanceBanner({
      relativePath,
      contentHash,
      state: 'Skeleton',
      reason,
      compactorVer: COMPACTOR_VERSION,
      parserVer: `typescript@${ts.version}`
    });

    return { content: `${banner}\n\n${skeletonCode}`, state: 'Skeleton' };

  } catch (err) {
    return { content: rawContent, state: 'Full', warning: `AST transformation exception: ${err.message}` };
  }
}

function generateProvenanceBanner({ relativePath, contentHash, state, reason, compactorVer, parserVer }) {
  return [
    '// =================================================================================',
    '// [COMPACTED SKELETON]',
    `// Source Path:         ${relativePath}`,
    `// Source Content Hash: ${contentHash}`,
    `// Compaction State:    ${state}`,
    `// Selection Reason:    ${reason}`,
    `// Compactor Ver:       ${compactorVer}`,
    `// Parser Engine:       ${parserVer}`,
    `// RESTORE COMMAND:     npm run kb:compact -- --restore ${relativePath}`,
    `// DUMP COMMAND:        npm run kb:compact -- --dump ${relativePath}`,
    '// ================================================================================='
  ].join('\n');
}
