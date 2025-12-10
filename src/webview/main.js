const vscode = acquireVsCodeApi();
const img = document.getElementById("img");
const resizer = document.getElementById("resizer");
const container = document.getElementById("container");

let isResizing = false;

// --- Update Function for Inputs ---
function updateStyle() {
    const width = document.getElementById("width").value;
    const height = document.getElementById("height").value;
    const radius = document.getElementById("radius").value;
    const borderColor = document.getElementById("borderColor").value;
    const borderWidth = document.getElementById("borderWidth").value;
    const shadow = document.getElementById("shadow").value;
    const filter = document.getElementById("filter").value;

    // Update visual preview
    if (width) img.style.width = width + "px";
    if (height) img.style.height = height + "px";
    img.style.borderRadius = radius;
    img.style.borderColor = borderColor;
    if (borderWidth) {
        img.style.borderWidth = borderWidth + "px";
        img.style.borderStyle = "solid"; // Visual preview needs this too
    } else {
        img.style.borderWidth = "0"; // Ensure no border if width is empty
        img.style.borderStyle = "none"; // Ensure no border style if width is empty
    }
    img.style.boxShadow = shadow;
    img.style.filter = filter;

    vscode.postMessage({
        type: "updateStyle",
        style: {
            width: width ? `${width}px` : null,
            height: height ? `${height}px` : null, // Assuming px for manual input, or whatever user typed if text input (but here input type=number implies px usually, logic below supports string)
            borderRadius: radius,
            borderColor,
            borderWidth: borderWidth ? `${borderWidth}px` : null,
            borderStyle: borderWidth ? 'solid' : null, // Fix: default to solid if width exists
            boxShadow: shadow,
            filter: filter
        }
    });
}

// Bind all inputs
document.querySelectorAll("input, select").forEach(input => {
    input.addEventListener("input", updateStyle);
});


// --- Resizer Logic ---
resizer.addEventListener("mousedown", (e) => {
    isResizing = true;
    e.preventDefault();
});

window.addEventListener("mousemove", (e) => {
    if (!isResizing) return;

    // Calculate new width relative to the container's left edge
    const newWidth = Math.round(e.clientX - container.getBoundingClientRect().left);

    if (newWidth > 50) {
        img.style.width = newWidth + "px";
        img.style.height = "auto";

        // Sync to Input
        document.getElementById("width").value = newWidth;
        // height auto
    }
});

window.addEventListener("mouseup", () => {
    if (isResizing) {
        isResizing = false;
        // Trigger update to save change
        updateStyle();
    }
});
