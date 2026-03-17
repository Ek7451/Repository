// @ts-nocheck
function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function createDropdownMarkup() {
    return `
        <button type="button" data-bookmark-menu-action="rename">Rename</button>
        <button type="button" data-bookmark-menu-action="export">Export Image</button>
        <button type="button" class="cam-bookmark-remove" data-bookmark-menu-action="remove">Delete</button>
    `;
}

function getBookmarksArray(getBookmarks) {
    const bookmarks = typeof getBookmarks === 'function' ? getBookmarks() : null;
    return Array.isArray(bookmarks) ? bookmarks : null;
}

function slugifyFilePart(value, fallback = '') {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
    return normalized || fallback;
}

export class CameraBookmarks {
    constructor(options = {}) {
        const settings = /** @type {{
            barEl?: HTMLElement | null,
            listEl?: HTMLElement | null,
            saveBtnEl?: HTMLElement | null,
            toggleBtnEl?: HTMLElement | null,
            getBookmarks?: (() => Array<object>),
            getScene3D?: (() => object | null),
            getSportName?: (() => string),
            download?: ((descriptor: { filename: string, dataUrl: string }) => boolean | void),
            onLayoutChanged?: (() => void),
            promptForRename?: ((currentName: string) => string | null)
        }} */ (options && typeof options === 'object' ? options : {});

        this.barEl = settings.barEl ?? null;
        this.listEl = settings.listEl ?? null;
        this.saveBtnEl = settings.saveBtnEl ?? null;
        this.toggleBtnEl = settings.toggleBtnEl ?? null;
        this.getBookmarks = typeof settings.getBookmarks === 'function'
            ? settings.getBookmarks
            : () => [];
        this.getScene3D = typeof settings.getScene3D === 'function'
            ? settings.getScene3D
            : () => null;
        this.getSportName = typeof settings.getSportName === 'function'
            ? settings.getSportName
            : () => '';
        this.download = typeof settings.download === 'function'
            ? settings.download
            : () => false;
        this.onLayoutChanged = typeof settings.onLayoutChanged === 'function'
            ? settings.onLayoutChanged
            : () => {};
        this.promptForRename = typeof settings.promptForRename === 'function'
            ? settings.promptForRename
            : (currentName) => window.prompt('Rename view:', currentName);

        this._openDropdownIndex = null;
        this._dropdownEl = this._createDropdownElement();

        this._boundHandleSaveClick = this._handleSaveClick.bind(this);
        this._boundHandleToggleClick = this._handleToggleClick.bind(this);
        this._boundHandleListClick = this._handleListClick.bind(this);
        this._boundHandleListKeydown = this._handleListKeydown.bind(this);
        this._boundHandleDocumentClick = this._handleDocumentClick.bind(this);
        this._boundHandleDropdownClick = this._handleDropdownClick.bind(this);

        this._bindEvents();
    }

    _bindEvents() {
        this.saveBtnEl?.addEventListener('click', this._boundHandleSaveClick);
        this.toggleBtnEl?.addEventListener('click', this._boundHandleToggleClick);
        this.listEl?.addEventListener('click', this._boundHandleListClick);
        this.listEl?.addEventListener('keydown', this._boundHandleListKeydown);
        this._dropdownEl.addEventListener('click', this._boundHandleDropdownClick);
        document.addEventListener('click', this._boundHandleDocumentClick);
    }

    _createDropdownElement() {
        const dropdownEl = document.createElement('div');
        dropdownEl.className = 'cam-bookmark-dropdown';
        dropdownEl.dataset.state = 'closed';
        dropdownEl.hidden = true;
        dropdownEl.innerHTML = createDropdownMarkup();
        document.body.appendChild(dropdownEl);
        return dropdownEl;
    }

    destroy() {
        this.saveBtnEl?.removeEventListener('click', this._boundHandleSaveClick);
        this.toggleBtnEl?.removeEventListener('click', this._boundHandleToggleClick);
        this.listEl?.removeEventListener('click', this._boundHandleListClick);
        this.listEl?.removeEventListener('keydown', this._boundHandleListKeydown);
        this._dropdownEl.removeEventListener('click', this._boundHandleDropdownClick);
        document.removeEventListener('click', this._boundHandleDocumentClick);
        this.closeDropdown();
        this._dropdownEl.remove();
    }

    render({ notifyLayout = true } = {}) {
        if (!this.listEl) {
            if (notifyLayout) this.onLayoutChanged();
            return;
        }

        this.closeDropdown();

        const bookmarks = Array.isArray(this.getBookmarks()) ? this.getBookmarks() : [];
        this.listEl.innerHTML = bookmarks.map((bookmark, index) => this._renderBookmarkCard(bookmark, index)).join('');

        if (notifyLayout) this.onLayoutChanged();
    }

    _renderBookmarkCard(bookmark, index) {
        const name = escapeHtml(bookmark?.name ?? `View ${index + 1}`);
        const thumbnail = escapeHtml(bookmark?.thumbnail ?? '');
        return `
            <div class="cam-bookmark-card" data-bookmark-index="${index}" role="button" tabindex="0">
                <img class="cam-bookmark-image" src="${thumbnail}" alt="${name}">
                <div class="cam-bookmark-label">${name}</div>
                <div class="cam-bookmark-menu-wrapper">
                    <button
                        type="button"
                        class="cam-bookmark-menu-btn"
                        title="Options"
                        aria-haspopup="menu"
                        aria-expanded="${this._openDropdownIndex === index ? 'true' : 'false'}"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="5" r="1.5"></circle>
                            <circle cx="12" cy="12" r="1.5"></circle>
                            <circle cx="12" cy="19" r="1.5"></circle>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }

    _handleSaveClick() {
        let barExpanded = false;
        if (this.barEl?.classList.contains('collapsed')) {
            this.barEl.classList.remove('collapsed');
            barExpanded = true;
        }

        const bookmark = this.createCurrentBookmark();
        if (bookmark) {
            this.render();
            return;
        }

        if (barExpanded) this.onLayoutChanged();
    }

    _handleToggleClick() {
        if (!this.barEl) return;
        this.barEl.classList.toggle('collapsed');
        this.closeDropdown();
        this.onLayoutChanged();
    }

    _handleListClick(event) {
        const menuButton = event.target.closest('.cam-bookmark-menu-btn');
        if (menuButton) {
            event.stopPropagation();
            const cardEl = menuButton.closest('.cam-bookmark-card');
            const index = this._getBookmarkIndex(cardEl);
            if (index < 0) return;
            this._toggleDropdownForCard(cardEl, index);
            return;
        }

        const cardEl = event.target.closest('.cam-bookmark-card');
        if (!cardEl || event.target.closest('.cam-bookmark-menu-wrapper')) return;

        const index = this._getBookmarkIndex(cardEl);
        if (index < 0) return;

        this.closeDropdown();
        this.restoreBookmark(index);
    }

    _handleListKeydown(event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (event.target.closest('.cam-bookmark-menu-btn')) return;

        const cardEl = event.target.closest('.cam-bookmark-card');
        if (!cardEl) return;

        const index = this._getBookmarkIndex(cardEl);
        if (index < 0) return;

        event.preventDefault();
        this.closeDropdown();
        this.restoreBookmark(index);
    }

    _handleDropdownClick(event) {
        const actionButton = event.target.closest('[data-bookmark-menu-action]');
        if (!actionButton) return;

        event.stopPropagation();

        const index = this._openDropdownIndex;
        const bookmark = this._getBookmark(index);
        if (index === null || !bookmark) {
            this.closeDropdown();
            return;
        }

        const action = actionButton.dataset.bookmarkMenuAction;
        if (action === 'rename') {
            this.closeDropdown();
            const proposedName = this.promptForRename(bookmark.name);
            if (typeof proposedName === 'string' && proposedName.trim() !== '') {
                this.renameBookmark(index, proposedName.trim());
                this.render();
            }
            return;
        }

        if (action === 'export') {
            const viewName = bookmark.name;
            this.closeDropdown();
            this.restoreBookmark(index);
            window.setTimeout(() => {
                this.exportBookmarkImage(index, viewName);
            }, 50);
            return;
        }

        if (action === 'remove') {
            this.closeDropdown();
            this.removeBookmark(index);
            this.render();
        }
    }

    _handleDocumentClick(event) {
        if (event.target.closest('.cam-bookmark-menu-btn')) return;
        if (event.target.closest('.cam-bookmark-dropdown')) return;
        this.closeDropdown();
    }

    _toggleDropdownForCard(cardEl, index) {
        if (!cardEl) return;

        if (this._openDropdownIndex === index && !this._dropdownEl.hidden) {
            this.closeDropdown();
            return;
        }

        this._openDropdownIndex = index;
        this._dropdownEl.hidden = false;
        this._dropdownEl.dataset.state = 'positioning';

        const cardRect = cardEl.getBoundingClientRect();
        const dropdownWidth = this._dropdownEl.offsetWidth;
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || dropdownWidth;
        const left = clamp(
            cardRect.left + (cardRect.width / 2) - (dropdownWidth / 2),
            8,
            Math.max(8, viewportWidth - dropdownWidth - 8)
        );

        this._dropdownEl.style.bottom = `${window.innerHeight - cardRect.top + 8}px`;
        this._dropdownEl.style.left = `${left}px`;
        this._dropdownEl.style.top = 'auto';
        this._dropdownEl.style.right = 'auto';
        this._dropdownEl.dataset.state = 'open';

        this._updateMenuButtons();
    }

    _updateMenuButtons() {
        this.listEl?.querySelectorAll('.cam-bookmark-menu-btn').forEach((buttonEl) => {
            const cardEl = buttonEl.closest('.cam-bookmark-card');
            const index = this._getBookmarkIndex(cardEl);
            buttonEl.setAttribute(
                'aria-expanded',
                this._openDropdownIndex !== null && index === this._openDropdownIndex ? 'true' : 'false'
            );
        });
    }

    closeDropdown() {
        this._openDropdownIndex = null;
        this._dropdownEl.dataset.state = 'closed';
        this._dropdownEl.hidden = true;
        this._updateMenuButtons();
    }

    createCurrentBookmark() {
        const bookmarks = getBookmarksArray(this.getBookmarks);
        const scene3D = this.getScene3D?.();
        if (!bookmarks || !scene3D?.camera || !scene3D?.controls || !scene3D?.renderer) return null;

        const camera = /** @type {any} */ (scene3D.camera);
        const controls = /** @type {any} */ (scene3D.controls);

        scene3D.renderer.render(scene3D.scene, scene3D.camera);
        const bookmark = {
            name: `View ${bookmarks.length + 1}`,
            position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
            target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
            thumbnail: this._captureBookmarkThumbnail(scene3D, 150, 150)
        };
        bookmarks.push(bookmark);
        return bookmark;
    }

    renameBookmark(index, nextName) {
        const bookmark = this._getBookmark(index);
        if (!bookmark) return;
        bookmark.name = nextName;
    }

    removeBookmark(index) {
        const bookmarks = getBookmarksArray(this.getBookmarks);
        if (!bookmarks || !bookmarks[index]) return;
        bookmarks.splice(index, 1);
    }

    restoreBookmark(index) {
        const bookmark = this._getBookmark(index);
        const scene3D = this.getScene3D?.();
        if (!bookmark || !scene3D?.camera || !scene3D?.controls) return;

        const camera = /** @type {any} */ (scene3D.camera);
        const controls = /** @type {any} */ (scene3D.controls);
        camera.position.set(
            bookmark.position.x,
            bookmark.position.y,
            bookmark.position.z
        );
        controls.target.set(
            bookmark.target.x,
            bookmark.target.y,
            bookmark.target.z
        );
        controls.update();
    }

    exportBookmarkImage(index, fallbackName = null) {
        const scene3D = this.getScene3D?.();
        const bookmark = this._getBookmark(index);
        if (!scene3D?.renderer || !bookmark && !fallbackName) return;

        scene3D.renderer.render(scene3D.scene, scene3D.camera);
        const sportName = slugifyFilePart(this.getSportName?.(), 'seating');
        const viewName = slugifyFilePart(bookmark?.name ?? fallbackName, '');
        const suffix = viewName ? `-${viewName}` : '';
        this.download?.({
            filename: `3d-view-${sportName}${suffix}.png`,
            dataUrl: scene3D.renderer.domElement.toDataURL('image/png')
        });
    }

    _getBookmark(index) {
        if (!Number.isInteger(index) || index < 0) return null;
        const bookmarks = getBookmarksArray(this.getBookmarks);
        return bookmarks?.[index] ?? null;
    }

    _getBookmarkIndex(cardEl) {
        if (!cardEl) return -1;
        const index = Number.parseInt(cardEl.dataset.bookmarkIndex ?? '', 10);
        return Number.isInteger(index) ? index : -1;
    }

    _captureBookmarkThumbnail(scene3D, width = 100, height = 100) {
        try {
            const src = scene3D?.renderer?.domElement;
            const sw = src?.width || src?.clientWidth;
            const sh = src?.height || src?.clientHeight;
            if (!sw || !sh) return '';

            const crop = Math.min(sw, sh);
            const sx = Math.floor((sw - crop) / 2);
            const sy = Math.floor((sh - crop) / 2);

            const thumb = document.createElement('canvas');
            thumb.width = width;
            thumb.height = height;
            const ctx = thumb.getContext('2d');
            if (!ctx) return '';

            ctx.drawImage(src, sx, sy, crop, crop, 0, 0, width, height);
            return thumb.toDataURL('image/png');
        } catch (error) {
            console.warn('Failed to capture camera bookmark thumbnail:', error);
            return '';
        }
    }
}
