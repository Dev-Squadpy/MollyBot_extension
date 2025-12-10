"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const path = require("path");
// --- Global State ---
let currentPanel = undefined;
let lastImageUrl = undefined;
let activeImageTarget;
// Decoration for the active line
const activeLineDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(100, 150, 255, 0.1)',
    border: '1px solid rgba(100, 150, 255, 0.3)',
    isWholeLine: true
});
function activate(context) {
    console.log('MollyBot Image Inline Smart-Link Active');
    // 1. Register Command
    context.subscriptions.push(vscode.commands.registerCommand('imageDecorator.showImage', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const url = await vscode.window.showInputBox({
            prompt: "Enter Image URL",
            placeHolder: "https://example.com/image.png"
        });
        if (url) {
            createOrUpdateWebview(context, url, editor, editor.selection.active.line);
        }
    }));
    // 2. Auto-detection on Cursor Move
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(event => {
        handleEditorEvent(context, event.textEditor);
    }));
    // 3. Auto-detection on Typing
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
            handleEditorEvent(context, editor);
        }
    }));
    // 4. Panel Serializer
    vscode.window.registerWebviewPanelSerializer('imagePreview', {
        async deserializeWebviewPanel(panel, state) {
            currentPanel = panel;
            setupPanelListeners(context, panel);
        }
    });
}
function handleEditorEvent(context, editor) {
    const document = editor.document;
    const lineNumber = editor.selection.active.line;
    const lineText = document.lineAt(lineNumber).text;
    // Regex to find <img ... src="...">
    const imgRegex = /<img\s+[^>]*src=["']([^"']+)["']/i;
    const match = lineText.match(imgRegex);
    if (!match) {
        editor.setDecorations(activeLineDecorationType, []);
        return;
    }
    const imageUrl = match[1];
    const range = document.lineAt(lineNumber).range;
    editor.setDecorations(activeLineDecorationType, [range]);
    createOrUpdateWebview(context, imageUrl, editor, lineNumber);
}
function createOrUpdateWebview(context, imageUrl, editor, line) {
    // @ts-ignore
    activeImageTarget = { editor, line };
    if (currentPanel) {
        if (lastImageUrl !== imageUrl) {
            currentPanel.webview.html = getWebviewContent(currentPanel, context, imageUrl);
            lastImageUrl = imageUrl;
        }
        currentPanel.reveal(vscode.ViewColumn.Beside);
    }
    else {
        currentPanel = vscode.window.createWebviewPanel('imagePreview', 'Image Preview', vscode.ViewColumn.Beside, {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'src', 'webview'))]
        });
        setupPanelListeners(context, currentPanel);
        currentPanel.webview.html = getWebviewContent(currentPanel, context, imageUrl);
        lastImageUrl = imageUrl;
    }
}
function setupPanelListeners(context, panel) {
    panel.onDidDispose(() => {
        currentPanel = undefined;
        lastImageUrl = undefined;
        // @ts-ignore
        activeImageTarget = undefined;
    }, null, context.subscriptions);
    panel.webview.onDidReceiveMessage(message => {
        if (message.type === 'updateStyle') {
            // @ts-ignore
            if (activeImageTarget) {
                // @ts-ignore
                updateImageStyle(activeImageTarget.editor, activeImageTarget.line, message.style);
            }
            else {
                console.warn("No active image target found!");
            }
        }
    }, undefined, context.subscriptions);
}
// --- CORE LOGIC: Smart Linked CSS Update ---
async function updateImageStyle(editor, lineIndex, style) {
    const document = editor.document;
    if (lineIndex >= document.lineCount)
        return;
    const line = document.lineAt(lineIndex);
    const text = line.text;
    console.log("Updating Image Style. Analyzing priority...");
    // Priority 1: Class Selector (Highest now)
    const classMatch = text.match(/class=["']([^"']+)["']/);
    if (classMatch) {
        const className = classMatch[1].split(' ')[0]; // Take first class if multiple
        console.log(`>> Priority 1: Class '${className}' found. Searching LINKED CSS.`);
        const found = await updateLinkedCSS(editor, `.${className}`, style);
        if (found)
            return;
        console.log(`>> CSS rule for .${className} not found. Creating it in linked CSS.`);
        await updateLinkedCSS(editor, `.${className}`, style, true);
        return;
    }
    // Priority 2: ID Selector
    const idMatch = text.match(/id=["']([^"']+)["']/);
    if (idMatch) {
        const idName = idMatch[1];
        console.log(`>> Priority 2: ID '${idName}' found. Searching LINKED CSS.`);
        const found = await updateLinkedCSS(editor, `#${idName}`, style);
        if (found)
            return;
        console.log(`>> CSS rule for #${idName} not found. Creating it in linked CSS.`);
        await updateLinkedCSS(editor, `#${idName}`, style, true);
        return;
    }
    // Priority 3: Inline Style
    const styleRegex = /style=["'][^"']*["']/;
    if (styleRegex.test(text)) {
        console.log(">> Priority 3: Inline 'style' attribute found. Updating inline.");
        await updateInlineStyle(editor, line, text, style);
        return;
    }
    // Priority 4: Auto-Generate (Clean Image)
    console.log(">> No style/class/id. Auto-generating class.");
    const newClassName = `mollybot-img-${Date.now()}`;
    // Inject class into HTML matches <img ... > or <img ... />
    let newText = text;
    if (text.includes('/>')) {
        newText = text.replace('/>', ` class="${newClassName}" />`);
    }
    else {
        newText = text.replace('>', ` class="${newClassName}">`);
    }
    // Edit HTML first
    await editor.edit(editBuilder => {
        editBuilder.replace(line.range, newText);
    });
    // Then Create CSS in FIRST Linked file
    await updateLinkedCSS(editor, `.${newClassName}`, style, true);
}
// Helper: Update Inline Style
async function updateInlineStyle(editor, line, text, style) {
    const styleParts = [];
    for (const key in style) {
        if (style[key]) {
            const cssKey = key.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
            styleParts.push(`${cssKey}: ${style[key]}`);
        }
    }
    const newStyleBlock = `style="${styleParts.join("; ")}"`;
    // Replace existing style block
    const updated = text.replace(/style=["'][^"']*["']/, newStyleBlock);
    if (updated !== text) {
        await editor.edit(editBuilder => {
            editBuilder.replace(line.range, updated);
        });
    }
}
// Helper: Resolve Linked CSS Files
async function getLinkedCssFiles(editor) {
    const html = editor.document.getText();
    const htmlUri = editor.document.uri;
    const htmlDir = path.dirname(htmlUri.fsPath);
    console.log(`[Link Resolver] Scanning HTML: ${htmlUri.fsPath}`);
    console.log(`[Link Resolver] Base Dir: ${htmlDir}`);
    const cssFiles = [];
    // Improved regex: clearer capture
    const linkRegex = /<link\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
        const href = match[1];
        console.log(`[Link Resolver] Found href: ${href}`);
        if (!href.endsWith('.css')) {
            // Maybe continue, or strict? Let's skip non-css.
            continue;
        }
        // 1. Try Relative Path
        const resolvedPath = path.resolve(htmlDir, href);
        const uri = vscode.Uri.file(resolvedPath);
        try {
            await vscode.workspace.fs.stat(uri);
            console.log(`[Link Resolver] Success (Relative): ${resolvedPath}`);
            cssFiles.push(uri);
            continue;
        }
        catch (e) {
            console.log(`[Link Resolver] Not found relative: ${resolvedPath}`);
        }
        // 2. Try Workspace Root (if href has no path, or starts with /)
        if (vscode.workspace.workspaceFolders) {
            const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
            // Remove leading slash if present to join correctly
            const cleanHref = href.startsWith('/') || href.startsWith('\\') ? href.slice(1) : href;
            const rootPath = path.join(root, cleanHref);
            console.log(`[Link Resolver] Trying Root: ${rootPath}`);
            try {
                const rootUri = vscode.Uri.file(rootPath);
                await vscode.workspace.fs.stat(rootUri);
                console.log(`[Link Resolver] Success (Root): ${rootPath}`);
                cssFiles.push(rootUri);
            }
            catch (e) {
                console.log(`[Link Resolver] Not found at root either.`);
            }
        }
    }
    return cssFiles;
}
// Helper: Smart Linked CSS Update (with Global Fallback)
async function updateLinkedCSS(editor, selector, style, createIfMissing = false) {
    console.log(`[CSS] Updating ${selector} (Create: ${createIfMissing})`);
    // 1. Get ONLY linked files
    let files = await getLinkedCssFiles(editor);
    console.log(`[CSS] Found ${files.length} LINKED CSS files.`);
    // FALLBACK: If Strict Linking found nothing, try Global Search
    if (files.length === 0) {
        console.log("[CSS] No linked files found. Falling back to Global Search.");
        const globalFiles = await vscode.workspace.findFiles('**/*.css', '**/node_modules/**');
        // Filter out obvious noise? maybe.
        files = globalFiles;
        console.log(`[CSS] Found ${files.length} GLOBAL CSS files.`);
        if (files.length > 0) {
            vscode.window.setStatusBarMessage("MollyBot: Usando búsqueda global de CSS (Link no encontrado)", 5000);
        }
    }
    if (files.length === 0) {
        vscode.window.showErrorMessage("Error: No se encontró ningún archivo CSS en el workspace.");
        return false;
    }
    // Construct Rule Body
    let ruleBody = "";
    for (const key in style) {
        if (style[key]) {
            const cssKey = key.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
            ruleBody += `  ${cssKey}: ${style[key]};\n`;
        }
    }
    const fullRule = `${selector} {\n${ruleBody}}`;
    // Regex
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ruleRegex = new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\}`, "m");
    // 2. Scan available files
    for (const fileUri of files) {
        // Force open to get buffer
        try {
            const doc = await vscode.workspace.openTextDocument(fileUri);
            const text = doc.getText();
            const match = text.match(ruleRegex);
            if (match) {
                console.log(`[CSS] >> Found existing rule in ${fileUri.fsPath}`);
                // VISUAL FEEDBACK
                await vscode.window.showTextDocument(doc, {
                    viewColumn: vscode.ViewColumn.Beside,
                    preserveFocus: true,
                    preview: true
                });
                const edit = new vscode.WorkspaceEdit();
                const start = doc.positionAt(match.index);
                const end = doc.positionAt(match.index + match[0].length);
                edit.replace(fileUri, new vscode.Range(start, end), fullRule);
                const success = await vscode.workspace.applyEdit(edit);
                if (success)
                    await doc.save();
                vscode.window.showInformationMessage(`CSS Actualizado: ${path.basename(fileUri.fsPath)}`);
                console.log(`[CSS] >> Edit applied: ${success}`);
                return true;
            }
        }
        catch (e) {
            console.warn(`Could not open ${fileUri.fsPath}`, e);
        }
    }
    // 3. Create if missing
    if (createIfMissing) {
        // Use the FIRST file found (either linked or global)
        const targetUri = files[0];
        console.log(`[CSS] Rule not found. Creating in file: ${targetUri.fsPath}`);
        const edit = new vscode.WorkspaceEdit();
        try {
            const doc = await vscode.workspace.openTextDocument(targetUri);
            // VISUAL FEEDBACK
            await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Beside,
                preserveFocus: true,
                preview: true
            });
            const pos = new vscode.Position(doc.lineCount, 0);
            edit.insert(targetUri, pos, `\n${fullRule}\n`);
            const success = await vscode.workspace.applyEdit(edit);
            console.log(`[CSS] >> New rule created: ${success}`);
            await doc.save();
            vscode.window.showInformationMessage(`Regla CSS creada en: ${path.basename(targetUri.fsPath)}`);
        }
        catch (e) {
            console.error("[CSS] Failed to append CSS", e);
            vscode.window.showErrorMessage(`Failed to modify CSS: ${e}`);
        }
        return true;
    }
    return false;
}
function getWebviewContent(panel, context, imageUrl) {
    const scriptUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, "src", "webview", "main.js")));
    const stylesUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, "src", "webview", "styles.css")));
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${stylesUri}" rel="stylesheet">
    <title>Image Preview</title>
</head>
<body>
    <div class="controls">
      <label>Ancho (px): <input id="width" type="number" min="1" /></label>
      <label>Alto (px): <input id="height" type="number" min="1" /></label>

      <label>Borde (radio): <input id="radius" type="text" placeholder="e.g. 50%" /></label>
      <label>Borde (color): <input id="borderColor" type="color" value="#000000" /></label>
      <label>Borde (grosor): <input id="borderWidth" type="number" min="0" /></label>

      <label>Sombras: 
          <input id="shadow" type="text" placeholder="e.g. 5px 5px 10px #000"/>
      </label>

      <label>Filtro:
          <select id="filter">
            <option value="">Ninguno</option>
            <option value="blur(5px)">Blur</option>
            <option value="grayscale(100%)">Grayscale</option>
            <option value="sepia(100%)">Sepia</option>
            <option value="brightness(150%)">Brillo</option>
            <option value="contrast(200%)">Contraste</option>
            <option value="saturate(200%)">Saturación</option>
          </select>
      </label>
    </div>

    <div id="container">
        <img id="img" src="${imageUrl}" />
        <div id="resizer"></div>
    </div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
}
function deactivate() { }
//# sourceMappingURL=extension.js.map