import re

with open('app.js', 'r', encoding='utf-8') as f:
    js = f.read()

# Fix thumbnail capture sizing
js = js.replace('this._captureBookmarkThumbnail(100, 100)', 'this._captureBookmarkThumbnail(160, 160)')
js = js.replace('_captureBookmarkThumbnail(width = 100, height = 100)', '_captureBookmarkThumbnail(width = 160, height = 160)')

# Rewrite rendering logic to place dropdowns in the body to avoid overflow clipping
render_logic = r'''    _renderCameraBookmarks() {
        const list = document.getElementById('cameraBookmarksList');
        if (!list) return;
        list.innerHTML = '';

        // Clean up previously attached global dropdowns
        document.querySelectorAll('.cam-bookmark-global-dropdown').forEach(d => d.remove());

        this._cameraBookmarks.forEach((bm, i) => {
            const card = document.createElement('div');
            card.className = 'cam-bookmark-card';
            card.setAttribute('role', 'button');
            card.tabIndex = 0; card.innerHTML = 
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
                </div>
            ;

            // Create dropdown in body to escape overflow clipping
            const dropdown = document.createElement('div');
            dropdown.className = 'cam-bookmark-dropdown cam-bookmark-global-dropdown';
            dropdown.style.display = 'none';
            dropdown.innerHTML = 
                <button type="button" class="cam-bookmark-rename">Rename</button>
                <button type="button" class="cam-bookmark-export">Export Image</button>
                <button type="button" class="cam-bookmark-remove">Delete</button>
            ;
            document.body.appendChild(dropdown);

            const menuBtn = card.querySelector('.cam-bookmark-menu-btn');
            const renameBtn = dropdown.querySelector('.cam-bookmark-rename');
            const exportBtn = dropdown.querySelector('.cam-bookmark-export');
            const deleteBtn = dropdown.querySelector('.cam-bookmark-remove');

            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // close other open dropdowns
                document.querySelectorAll('.cam-bookmark-global-dropdown').forEach(d => {
                    if (d !== dropdown) d.style.display = 'none';
                });
                if (dropdown.style.display === 'none') {
                    const rect = menuBtn.getBoundingClientRect();
                    dropdown.style.position = 'fixed';
                    dropdown.style.top = 'auto'; // ensure it bounds upward or downward
                    
                    // Simple positioning: slightly offset above the button
                    dropdown.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
                    dropdown.style.left = (rect.left - 100) + 'px'; // align left edge nicely
                    dropdown.style.right = 'auto';
                    dropdown.style.zIndex = '99999';
                    
                    dropdown.style.display = 'flex';
                } else {
                    dropdown.style.display = 'none';
                }
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

            const restore = () => {
                if (!this.scene3D) return;
                this.scene3D.camera.position.set(bm.position.x, bm.position.y, bm.position.z);
                this.scene3D.controls.target.set(bm.target.x, bm.target.y, bm.target.z);
                this.scene3D.controls.update();
            };

            card.addEventListener('click', (e) => {
                if (e.target.closest('.cam-bookmark-menu-wrapper')) return;
                dropdown.style.display = 'none';
                restore();
            });
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    dropdown.style.display = 'none';
                    restore();
                }
            });

            list.appendChild(card);
        });

        const closeDropdowns = () => {
            document.querySelectorAll('.cam-bookmark-global-dropdown').forEach(d => {
                d.style.display = 'none';
            });
        };
        document.removeEventListener('click', this._globalBookmarkMenuCloser);
        this._globalBookmarkMenuCloser = closeDropdowns;
        document.addEventListener('click', this._globalBookmarkMenuCloser);
    }'''

js = re.sub(r'    _renderCameraBookmarks\(\)\s*\{[\s\S]*?document\.addEventListener\(' + "'click'" + r', this\._globalBookmarkMenuCloser\);\s+\}', render_logic, js)

with open('app.js', 'w', encoding='utf-8') as f:
    f.write(js)

with open('styles.css', 'r', encoding='utf-8') as f:
    css = f.read()

# Fix sizing
css = re.sub(r'\.camera-bookmarks-bar\s*\{[^}]*min-height:\s*120px;\s*height:\s*120px;[^}]*\}', '.camera-bookmarks-bar { position: relative; display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; background: rgba(255, 255, 255, 0.92); backdrop-filter: blur(8px); border-top: 1px solid var(--border-color); z-index: 20; flex-shrink: 0; transition: min-height 0.2s, height 0.2s, padding 0.2s; min-height: 180px; height: 180px; box-sizing: border-box; }', css)

css = re.sub(r'\.cam-bookmarks-list\s*\{[^}]*min-height:\s*100px;[^}]*\}', '.cam-bookmarks-list { display: flex; align-items: flex-start; gap: 10px; flex: 1; overflow-x: auto; min-height: 160px; padding-bottom: 8px; }', css)

css = re.sub(r'\.cam-bookmark-card\s*\{[^}]*width:\s*100px;\s*height:\s*100px;[^}]*\}', '.cam-bookmark-card { position: relative; width: 160px; height: 160px; flex: 0 0 auto; display: flex; flex-direction: column; border: 1px solid var(--border-color); border-radius: 10px; background: #ffffff; color: var(--text-secondary); font-size: 11px; font-weight: 500; cursor: pointer; transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease; box-shadow: var(--shadow-sm); overflow: visible; }', css)

css = re.sub(r'\.cam-bookmark-dropdown\s*\{[^}]*inset:\s*0;[^}]*\}', '.cam-bookmark-dropdown { position: absolute; background: rgba(255, 255, 255, 0.95); border-radius: 10px; backdrop-filter: blur(4px); display: flex; flex-direction: column; justify-content: center; align-items: stretch; overflow: hidden; z-index: 99999; border: 1px solid var(--border-color); box-shadow: var(--shadow-md); min-width: 140px; }', css)

with open('styles.css', 'w', encoding='utf-8') as f:
    f.write(css)

print("Done")
