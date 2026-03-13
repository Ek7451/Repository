import re

# Update app.js
with open('app.js', 'r', encoding='utf-8') as f:
    js = f.read()

js = re.sub(
    r'([ \t]+const saveCamBtn.*?_saveCameraBookmark\(\)\);)\s+const exportViewBtn[^;]+;\s+if \(exportViewBtn\)[^;]+;',
    r'\1\n        const toggleBookmarksBtn = document.getElementById("toggleBookmarksBtn");\n        const cameraBookmarksBar = document.getElementById("cameraBookmarksBar");\n        if (toggleBookmarksBtn && cameraBookmarksBar) toggleBookmarksBtn.addEventListener("click", () => cameraBookmarksBar.classList.toggle("collapsed"));',
    js
)

new_card_html = r'''            card.innerHTML = 
                <img class="cam-bookmark-image" src="" alt="">
                <div class="cam-bookmark-label"></div>
                <div class="cam-bookmark-menu-wrapper">
                    <button type="button" class="cam-bookmark-menu-btn" title="Options">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="5" r="1.5"></circle>
                            <circle cx="12" cy="12" r="1.5"></circle>
                            <circle cx="12" cy="19" r="1.5"></circle>
                        </svg>
                    </button>
                    <div class="cam-bookmark-dropdown" style="display:none;">
                        <button type="button" class="cam-bookmark-rename">Rename</button>
                        <button type="button" class="cam-bookmark-export">Export Image</button>
                        <button type="button" class="cam-bookmark-remove">Delete</button>
                    </div>
                </div>
            ;
'''

menu_logic = r'''
            const menuBtn = card.querySelector('.cam-bookmark-menu-btn');
            const dropdown = card.querySelector('.cam-bookmark-dropdown');
            const renameBtn = card.querySelector('.cam-bookmark-rename');
            const exportBtn = card.querySelector('.cam-bookmark-export');
            const deleteBtn = card.querySelector('.cam-bookmark-remove');

            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.cam-bookmark-dropdown').forEach(d => {
                    if (d !== dropdown) d.style.display = 'none';
                });
                dropdown.style.display = dropdown.style.display === 'none' ? 'flex' : 'none';
            });

            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.style.display = 'none';
                const newName = prompt("Rename view:", bm.name);
                if (newName && newName.trim() !== "") {
                    bm.name = newName.trim();
                    this._renderCameraBookmarks();
                }
            });

            exportBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.style.display = 'none';
                restore();
                setTimeout(() => {
                    this._export3DImage(bm.name);
                }, 50);
            });

            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.style.display = 'none';
                this._cameraBookmarks.splice(i, 1);
                this._renderCameraBookmarks();
            });
'''

# Replace card html
js = re.sub(
    r'\s+card\.innerHTML = [\s\S]*?;\s+const deleteBtn = card\.querySelector[\s\S]*?this\._renderCameraBookmarks\(\);\s+\}\);',
    new_card_html + menu_logic,
    js
)

# update click handlers ignoring menu clicks
js = re.sub(
    r'card\.addEventListener\(' + "'click'" + r', \(e\) => \{\s+if \(e\.target\.closest\(' + "'.cam-bookmark-delete'" + r'\)\) return;\s+restore\(\);\s+\}\);',
    r"card.addEventListener('click', (e) => {\n                if (e.target.closest('.cam-bookmark-menu-wrapper')) return;\n                restore();\n            });",
    js
)

js = re.sub(
    r'if \(e\.target\.closest\(' + "'.cam-bookmark-delete'" + r'\)\)',
    r"if (e.target.closest('.cam-bookmark-menu-wrapper'))",
    js
)

# Close dropdowns automatically
js = re.sub(
    r'(list\.appendChild\(card\);\s+\}\);\s+)\}',
    r"\1\n        const closeDropdowns = () => {\n            document.querySelectorAll('.cam-bookmark-dropdown').forEach(d => {\n                d.style.display = 'none';\n            });\n        };\n        document.removeEventListener('click', this._globalBookmarkMenuCloser);\n        this._globalBookmarkMenuCloser = closeDropdowns;\n        document.addEventListener('click', this._globalBookmarkMenuCloser);\n    }",
    js
)

# adjust export3DImage
js = re.sub(
    r'_export3DImage\(\)\s*\{',
    r'_export3DImage(viewName = null) {',
    js
)

js = re.sub(
    r'(const sportName = document\.getElementById\(' + "'sportSelect'" + r'\)\.value;)([^<]+)a\.download = 3d-view-\$\{([^}]+)\}\.png;',
    r'\1\n        const suffix = viewName ? - : "";\n        a.download = 3d-view-.png;',
    js
)

with open('app.js', 'w', encoding='utf-8') as f:
    f.write(js)

print("Updated app.js")

# Update styles.css
with open('styles.css', 'r', encoding='utf-8') as f:
    css = f.read()

new_css = r'''
.cam-bookmarks-header {
    display: flex;
    align-items: center;
    justify-content: center;
    padding-right: 10px;
    border-right: 1px solid var(--border-color);
}

.camera-bookmarks-bar.collapsed {
    min-height: 48px;
    height: 48px;
    overflow: hidden;
    padding-bottom: 0px;
}

.camera-bookmarks-bar.collapsed .cam-bookmark-btn,
.camera-bookmarks-bar.collapsed .cam-bookmarks-list {
    display: none;
}

.camera-bookmarks-bar.collapsed #toggleBookmarksBtn svg {
    transform: rotate(180deg);
}

.cam-bookmark-menu-wrapper {
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 10;
}

.cam-bookmark-menu-btn {
    background: rgba(17, 24, 39, 0.4);
    color: white;
    border: none;
    border-radius: 4px;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s;
    backdrop-filter: blur(2px);
}

.cam-bookmark-menu-btn:hover {
    background: rgba(17, 24, 39, 0.85);
}

.cam-bookmark-dropdown {
    position: absolute;
    top: 26px;
    right: 0px;
    background: white;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    box-shadow: var(--shadow-md);
    display: flex;
    flex-direction: column;
    min-width: 110px;
    overflow: hidden;
    z-index: 20;
}

.cam-bookmark-dropdown button {
    background: transparent;
    border: none;
    padding: 8px 12px;
    font-size: 12px;
    font-family: inherit;
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s;
}

.cam-bookmark-dropdown button:hover {
    background: var(--bg-hover);
}

.cam-bookmark-dropdown .cam-bookmark-remove {
    color: var(--accent-red);
    border-top: 1px solid var(--border-color);
}

.cam-bookmark-dropdown .cam-bookmark-remove:hover {
    background: #fef2f2;
}

'''

# Only append if not exists
if 'cam-bookmark-menu-wrapper' not in css:
    css += new_css
    with open('styles.css', 'w', encoding='utf-8') as f:
        f.write(css)
    print("Updated styles.css with bookmark menu rules")
else:
    print("styles.css already contains bookmark menu rules")
