// ==UserScript==
// @name         pure bleh
// @namespace    https://github.com/imyimang/pure-bleh
// @version      1.0.0
// @description  Markdown, styled text and images in shouts and about me, plus album artwork upload title autofill. No appearance changes.
// @author       imyimang
// Based on the original bleh userscript by katelyn: https://github.com/katelyynn/bleh
// @match        https://www.last.fm/*
// @match        http://www.last.fm/*
// @match        https://last.fm/*
// @icon         https://www.last.fm/favicon.ico
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      *
// @connect      images.weserv.nl
// @connect      img.youtube.com
// ==/UserScript==

(() => {
	'use strict';

	const PROCESSED = 'data-bleh-pure';
	const TITLE_MARKER = 'data-bleh-pure-title';
	const CSP_MARKER = 'data-bleh-pure-csp';
	const FETCH_MARKER = 'data-bleh-pure-fetched';
	const COMPAT_MARKER = 'data-bleh-pure-compat';
	const PROXY_FREE = [
		'count.getloli.com',
		'i.imgur.com',
		'media1.tenor.com',
		'katelyynn.github.io',
		'i.pinimg.com',
		'i.ibb.co',
		'static.klipy.com',
		'static2.klipy.com',
		'cdn.discordapp.com',
		'lastfm.freetls.fastly.net',
		'lastfm-img.freetls.fastly.net',
		'last.fm',
		'files.catbox.moe',
	];
	const ROOT = `${location.protocol}//${location.host}`;
	const initializedTitles = new WeakSet();
	const markdownSignal = /\[(?:url|artist|album|track|font|left|center|right|links)\b[^\]]*\]|\[\/(?:url|artist|album|track|left|center|right|links)\]|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|https?:\/\/|www\.|@[a-z0-9_]+|`[^`]+`|\*\*[^*]+\*\*|~~[^~]+~~|__[^_]+__|<t:\d|^#{1,6}\s|^>\s|^\s*(?:[-*]\s|\d+\.\s)|\n/im;

	function escapeHtml(value) {
		return value.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
	}

	function escapeAttr(value) {
		return escapeHtml(value).replace(/"/g, '&quot;');
	}

	function safeUrl(value) {
		const trimmed = value.replace(/&amp;/g, '&')
			.replace(/&quot;/g, '"')
			.trim();
		if (!trimmed) return null;

		try {
			const url = new URL(trimmed, ROOT);
			if (url.protocol !== 'http:' && url.protocol !== 'https:') {
				return null;
			}
			return url.href;
		} catch {
			return null;
		}
	}

	function proxyImage(url) {
		try {
			if (PROXY_FREE.includes(new URL(url).hostname)) return url;
		} catch {}

		return `https://images.weserv.nl/?url=${encodeURIComponent(url)}&output=webp&n=-1`;
	}

	function link(url, label) {
		const href = safeUrl(url);
		if (!href) return label;

		return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer" style="color:#0b84ff;text-decoration:underline">${label}</a>`;
	}

	function renderMarkdown(source) {
		const stash = [];
		const hold = html => `\u0000${stash.push(html) - 1}\u0000`;
		const restore = html =>
			html.replace(/\u0000(\d+)\u0000/g, (_, index) => stash[Number(index)] || '');

		let text = String(source).replace(/\r\n?/g, '\n');

		const font = /\[font=([^\]]+)\]/i.exec(text)?.[1]
			?.split(',')[0]
			.trim() || null;

		text = text.replace(/```([\s\S]*?)```/g, (_, code) =>
			hold(`<pre><code>${escapeHtml(code.replace(/^\n|\n$/g, ''))}</code></pre>`)
		);
		text = text.replace(/`([^`\n]+)`/g, (_, code) =>
			hold(`<code>${escapeHtml(code)}</code>`)
		);
		text = text.replace(/<t:(\d{9,})(?::([FfDdTtR]))?>/g, (_, stamp, flag) => {
			const date = new Date(Number(stamp) * 1000);
			const options = flag === 'D'
				? { dateStyle: 'short' }
				: flag === 'T'
				? { timeStyle: 'short' }
				: { dateStyle: 'medium', timeStyle: 'short' };
			const label = Number.isNaN(date.getTime())
				? stamp
				: date.toLocaleString(undefined, options);
			return hold(
				`<time datetime="${date.toISOString?.() || ''}">${escapeHtml(label)}</time>`
			);
		});

		text = text.replace(/\[(?:banner|accent|name|status|links)=[^\]]*\]/gi, '');
		text = text.replace(/\[\/(?:links)\]/gi, '');
		text = text.replace(/\[font=[^\]]*\]/gi, '');
		text = escapeHtml(text);

		text = text.replace(
			/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi,
			(_, url, label) => link(url, label)
		);
		text = text.replace(
			/\[url\]([\s\S]*?)\[\/url\]/gi,
			(_, url) => link(url, url)
		);
		text = text.replace(
			/\[artist\]([\s\S]*?)\[\/artist\]/gi,
			(_, name) => link(`${ROOT}/music/${encodeURI(name)}`, name)
		);
		text = text.replace(
			/\[album artist=([^\]]+)\]([\s\S]*?)\[\/album\]/gi,
			(_, artist, album) =>
				link(
					`${ROOT}/music/${encodeURI(artist)}/${encodeURI(album)}`,
					album
				)
		);
		text = text.replace(
			/\[track artist=([^\]]+)\]([\s\S]*?)\[\/track\]/gi,
			(_, artist, track) =>
				link(
					`${ROOT}/music/${encodeURI(artist)}/_/${encodeURI(track)}`,
					track
				)
		);

		text = text.replace(
			/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
			(_, alt, url, title) => {
				const src = safeUrl(url);
				if (!src) return '';
				return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${
					title ? ` title="${escapeAttr(title)}"` : ''
				} loading="lazy">`;
			}
		);
		text = text.replace(
			/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
			(_, label, url) => link(url, label)
		);

		text = text.replace(
			/(^|[\s(])((?:https?:\/\/|www\.)[^\s<>()]+)/gi,
			(match, before, raw) => {
				const punctuation = raw.match(/[.,!?;:]+$/)?.[0] || '';
				const url = punctuation ? raw.slice(0, -punctuation.length) : raw;
				const href = /^www\./i.test(url) ? `https://${url}` : url;
				if (!safeUrl(href)) return match;
				return `${before}${hold(link(href, url))}${punctuation}`;
			}
		);

		text = text.replace(
			/\[(left|center|right)\]([\s\S]*?)\[\/\1\]/gi,
			(_, align, inner) =>
				`<span style="display:block;text-align:${
					align.toLowerCase()
				}">${
					renderMarkdown(inner).html.replace(/<\/?p>/g, '')
				}</span>`
		);

		text = text.replace(
			/(^|[\s([{.,])@([a-z0-9_]{1,20})(?!@)(?=$|[^\w])/gi,
			(_, before, name) =>
				`${before}<a href="${ROOT}/user/${name}">@${name}</a>`
		);

		text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
		text = text.replace(/__([^_\n]+)__/g, '<u>$1</u>');
		text = text.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
		text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
		text = text.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');

		const output = [];
		let paragraph = [];
		let list = null;
		let quote = [];

		function flushParagraph() {
			if (!paragraph.length) return;
			output.push(paragraph.join('<br>'));
			paragraph = [];
		}

		function flushList() {
			if (!list) return;
			output.push(
				`<${list.type}>${
					list.items.map(item => `<li>${item}</li>`).join('')
				}</${list.type}>`
			);
			list = null;
		}

		function flushQuote() {
			if (!quote.length) return;
			output.push(`<blockquote>${quote.join('<br>')}</blockquote>`);
			quote = [];
		}

		function flushAll() {
			flushParagraph();
			flushList();
			flushQuote();
		}

		text.split('\n').forEach(line => {
			const trimmed = line.trim();

			if (!trimmed) {
				flushAll();
				return;
			}

			const stashed = /^\u0000(\d+)\u0000$/.exec(trimmed);
			if (stashed) {
				flushAll();
				output.push(stash[Number(stashed[1])] || '');
				return;
			}

			const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
			if (heading) {
				flushAll();
				const level = Math.min(heading[1].length + 2, 6);
				output.push(`<h${level}>${heading[2]}</h${level}>`);
				return;
			}

			const unordered = /^[-*]\s+(.*)$/.exec(trimmed);
			const ordered = /^\d+\.\s+(.*)$/.exec(trimmed);
			if (unordered || ordered) {
				flushParagraph();
				flushQuote();
				const type = unordered ? 'ul' : 'ol';
				if (!list || list.type !== type) {
					flushList();
					list = { type, items: [] };
				}
				list.items.push((unordered || ordered)[1]);
				return;
			}

			const quoted = /^&gt;\s?(.*)$/.exec(trimmed);
			if (quoted) {
				flushParagraph();
				flushList();
				quote.push(quoted[1]);
				return;
			}

			flushList();
			flushQuote();
			paragraph.push(trimmed);
		});

		flushAll();

		return { html: restore(output.join('')), font };
	}

	function requestImage(image, url) {
		const request = (typeof GM !== 'undefined' && GM.xmlHttpRequest) ||
			(typeof GM_xmlhttpRequest !== 'undefined' && GM_xmlhttpRequest);
		if (!request) return;

		request({
			method: 'GET',
			url,
			responseType: 'blob',
			onload: response => {
				const blob = response?.response;
				if (!blob) return;

				if (typeof blob === 'string') {
					image.src = blob.startsWith('data:')
						? blob
						: `data:image/png;base64,${btoa(blob)}`;
					return;
				}

				const reader = new FileReader();
				reader.onload = () => {
					image.src = reader.result;
				};
				reader.readAsDataURL(blob);
			},
		});
	}

	function renderInto(element, className, copyClasses) {
		if (element.hasAttribute(PROCESSED)) return;
		element.setAttribute(PROCESSED, '');

		const source = element.textContent;
		if (!markdownSignal.test(source)) return;

		const { html, font } = renderMarkdown(source);
		if (!html) return;

		const container = document.createElement('div');
		container.className = 'bleh-pure-markdown';
		if (copyClasses) {
			element.classList.forEach(name => container.classList.add(name));
		}
		if (className) container.classList.add(className);
		if (font) container.style.fontFamily = font;

		if (element.tagName === 'P' && typeof getComputedStyle === 'function') {
			const originalStyle = getComputedStyle(element);
			if (originalStyle.marginTop && originalStyle.marginTop !== '0px') {
				container.style.marginTop = originalStyle.marginTop;
			}
			if (originalStyle.marginBottom && originalStyle.marginBottom !== '0px') {
				container.style.marginBottom = originalStyle.marginBottom;
			}
		}

		container.innerHTML = html;

		container.querySelectorAll('img').forEach(image => {
			const original = image.src;
			image.setAttribute('data-unsafe-href', encodeURI(original));

			image.style.maxWidth = '100%';
			image.style.width = 'auto';
			image.style.height = 'auto';
			image.style.objectFit = 'contain';
			image.style.display = 'block';

			const proxied = proxyImage(original);
			image.src = proxied;

			image.addEventListener('error', () => {
				if (image.getAttribute(FETCH_MARKER)) return;
				image.setAttribute(FETCH_MARKER, '');
				requestImage(image, proxied);
			});
		});

		container.querySelectorAll('*').forEach(child => {
			child.setAttribute(PROCESSED, '');
		});

		element.replaceWith(container);
	}

	function albumNameFromUrl() {
		const resource = document.body.querySelector('[data-page-resource-name]');
		const name = resource?.getAttribute('data-page-resource-name');
		if (name) return name;

		const parts = location.pathname.split('/').filter(Boolean);
		if (parts[0] !== 'music') return null;

		const images = parts.indexOf('+images');
		const hasUpload = images >= 0;

		if (
			hasUpload && parts[parts.length - 1] !== 'image-upload'
		) return null;

		const albumParts = (hasUpload ? parts.slice(1, images) : parts.slice(1))
			.filter(part => !part.startsWith('+'));
		if (albumParts.length !== 2) return null;

		const albumIndex = parts.lastIndexOf(
			albumParts[1],
			hasUpload ? images - 1 : parts.length - 1
		);
		const albumPath = `/${parts.slice(0, albumIndex + 1).join('/')}`;
		const breadcrumb = document.querySelector(
			`.content-top a[href="${albumPath}"], .subpage-breadcrumb a[href="${albumPath}"]`
		);
		if (breadcrumb && breadcrumb.textContent.trim()) {
			return breadcrumb.textContent.trim();
		}

		return decodeURIComponent(albumParts[1].replace(/\+/g, ' '));
	}

	function findTitleInput() {
		const inputs = [...document.querySelectorAll(
			'input[name="title"], textarea[name="title"]'
		)];
		if (!inputs.length) return null;

		const fileForm = document.querySelector('input[type="file"]')?.closest('form');
		if (fileForm) {
			const inFileForm = inputs.find(input => input.closest('form') === fileForm);
			if (inFileForm) return inFileForm;
		}

		return inputs.find(input => {
			const form = input.closest('form');
			if (!form) return false;

			const action = form.getAttribute('action') || '';
			return action.includes('image') || action.includes('upload') ||
				form.getAttribute('enctype') === 'multipart/form-data';
		}) || inputs.find(input => input.closest('.col-main, .content, main')) ||
			inputs[inputs.length - 1];
	}

	function fillAlbumTitle() {
		const name = albumNameFromUrl();
		if (!name) return;

		const input = findTitleInput();
		if (!input) return;

		const previous = input.getAttribute(TITLE_MARKER);
		const firstTime = !initializedTitles.has(input);

		if (firstTime || !input.value.trim() || input.value === previous) {
			input.value = name;
			input.setAttribute(TITLE_MARKER, name);
			initializedTitles.add(input);
			input.dispatchEvent(new Event('input', { bubbles: true }));
			input.dispatchEvent(new Event('change', { bubbles: true }));
		}
	}

	function allowImages() {
		if (document.head.querySelector(`meta[${CSP_MARKER}]`)) return;

		const meta = document.createElement('meta');
		meta.setAttribute(CSP_MARKER, '');
		meta.setAttribute('http-equiv', 'Content-Security-Policy');
		meta.setAttribute('content', 'img-src * data: blob:');
		document.head.prepend(meta);
	}

	function normalisePercent(value) {
		const percent = String(value).trim();
		return percent === '99%' ? '100%' : percent;
	}

	function compatibilityPercent(scope) {
		const candidates = [
			...scope.querySelectorAll(
				'[class*="tasteometer-viz"], [class*="tasteometer-viz"] *, [title], [aria-label], [data-percent]'
			),
		];

		for (const element of candidates) {
			for (const attribute of ['title', 'aria-label', 'data-percent']) {
				const value = element.getAttribute(attribute);
				if (value && /^\d{1,3}(?:\.\d+)?%$/.test(value.trim())) {
					return normalisePercent(value);
				}
			}

			const width = element.getAttribute('style')
				?.match(/width:\s*(\d{1,3}(?:\.\d+)?)%/i)?.[1];
			if (width) return normalisePercent(`${width}%`);
		}

		return null;
	}

	function compatibilityMarker(percent) {
		const marker = document.createElement('span');
		marker.className = 'bleh-pure-compat-percent';
		marker.setAttribute(COMPAT_MARKER, '');
		marker.style.color = 'inherit';
		marker.textContent = `(${percent})`;
		return marker;
	}

	function expandArtistShouts() {
		const join = document.querySelector('.btn-shouts-join');
		if (!join || join.hasAttribute(PROCESSED)) return;
		join.setAttribute(PROCESSED, '');

		const box = document.createElement('section');
		box.className = 'shoutbox-preview lazy-shoutbox shoutbox--with-header';
		box.id = 'shoutbox';

		const heading = document.createElement('h2');
		heading.className = 'subpage-title';
		heading.textContent = 'Shouts';

		const initial = new URLSearchParams(location.search).get('shoutbox-sort');
		let currentSort = initial === 'newest' ? 'newest' : 'popular';

		const sort = document.createElement('button');
		sort.className = 'disclose-trigger dropdown-menu-clickable-button';
		sort.setAttribute('aria-expanded', 'false');
		sort.setAttribute('aria-controls', 'shoutbox-sort');
		sort.setAttribute('data-disclose-select', '');
		sort.setAttribute('data-dropdown-layout-at', 'right-6 bottom');

		const srLabel = document.createElement('span');
		srLabel.className = 'sr-only';
		srLabel.textContent = 'Sorted by: ';
		const sortText = document.createTextNode('');
		sort.append(srLabel, sortText);

		const menu = document.createElement('ul');
		menu.className = 'dropdown-menu-clickable disclose-hide--js-only';
		menu.id = 'shoutbox-sort';
		menu.setAttribute('data-dropdown-layout-align', 'right');
		menu.style.position = 'absolute';
		menu.style.left = 'auto';
		menu.style.right = '0';
		menu.style.top = '100%';
		menu.style.zIndex = '50';

		const sortItems = [['newest', 'Newest'], ['popular', 'Recently Popular']]
			.map(([value, label]) => {
				const item = document.createElement('a');
				item.className = 'dropdown-menu-clickable-item';
				item.textContent = label;
				item.setAttribute('data-sort-link', '');
				item.setAttribute('data-sort-element', '');
				item.setAttribute('data-sort', value);
				item.href = `${location.pathname}/+shoutbox?sort=${value}#shoutbox`;
				item.setAttribute('data-partial-href', `?sort=${value}`);

				const listItem = document.createElement('li');
				listItem.appendChild(item);
				menu.appendChild(listItem);
				return [value, item];
			});

		const sortWrap = document.createElement('div');
		sortWrap.style.position = 'relative';
		sortWrap.append(sort, menu);

		function setMenu(open) {
			menu.hidden = !open;
			menu.style.display = open ? '' : 'none';
			sort.setAttribute('aria-expanded', open ? 'true' : 'false');
			sort.classList.toggle('disclose-active', open);
		}
		setMenu(false);

		function updateSortLabel() {
			sortText.textContent = currentSort === 'newest'
				? 'Newest'
				: 'Recently Popular';
			sortItems.forEach(([value, item]) => {
				item.classList.toggle(
					'dropdown-menu-clickable-item--selected',
					value === currentSort
				);
			});
		}
		updateSortLabel();

		const headerRow = document.createElement('div');
		headerRow.className = 'top-container';
		headerRow.style.display = 'flex';
		headerRow.style.justifyContent = 'space-between';
		headerRow.style.alignItems = 'center';
		headerRow.appendChild(heading);
		headerRow.appendChild(sortWrap);

		box.replaceChildren(headerRow, document.createTextNode('Loading shouts…'));
		join.replaceWith(box);

		const load = chosen => {
			currentSort = chosen;
			updateSortLabel();
			setMenu(false);

			const params = new URLSearchParams(location.search);
			params.set('shoutbox-sort', chosen);

			fetch(`${location.pathname}/+partial/shoutbox?${params}`, {
				credentials: 'same-origin',
			})
				.then(response => {
					if (!response.ok) throw new Error();
					return response.text();
				})
				.then(markup => {
					const parsed = new DOMParser().parseFromString(markup, 'text/html');
					const partial = parsed.querySelector('.shoutbox');
					if (!partial) throw new Error();

					const imported = document.importNode(partial, true);
					[...imported.children]
						.filter(element => element.tagName === 'H2')
						.forEach(element => {
							element.style.display = 'none';
						});

					box.replaceChildren(headerRow, imported);
					scan();
				})
				.catch(() => {
					box.replaceChildren(headerRow);
				});
		};

		sort.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			setMenu(menu.hidden);
		}, true);

		sortItems.forEach(([value, item]) => {
			item.addEventListener('click', event => {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				load(value);
			}, true);
		});

		document.addEventListener('click', event => {
			if (!sortWrap.contains(event.target)) setMenu(false);
		});

		load(currentSort);
	}

	function patchCompatibility() {
		document.querySelectorAll('.tasteometer-compat-description').forEach(description => {
			if (description.querySelector(`[${COMPAT_MARKER}]`)) return;

			const rating = description.querySelector(
				'.tasteometer-compat-colour, .tasteometer-compat-Color'
			);
			if (!rating) return;

			const scope = description.closest('.tasteometer') ||
				description.parentElement || document;
			const percent = compatibilityPercent(scope) ||
				compatibilityPercent(document);
			if (!percent) return;

			rating.appendChild(document.createTextNode(' '));
			rating.appendChild(compatibilityMarker(percent));
		});
	}

	function fixSortArrow() {
		if (document.querySelector('style[data-bleh-pure-sort-arrow]')) return;
		const style = document.createElement('style');
		style.setAttribute('data-bleh-pure-sort-arrow', '');
		style.textContent = '#shoutbox-sort::before{left:auto!important;right:12px!important;transform:none!important;margin-left:0!important;margin-right:0!important}';
		(document.head || document.documentElement).appendChild(style);
	}

	function scan() {
		document.querySelectorAll(
			`.shout .shout-body p:not([${PROCESSED}]), .about-me-sidebar > p:not([${PROCESSED}])`
		).forEach(element => {
			const isAbout = element.parentElement?.classList
				.contains('about-me-sidebar');
			renderInto(element, isAbout ? 'about-me-content' : '', true);
		});

		fillAlbumTitle();
		patchCompatibility();
		expandArtistShouts();
	}

	let timer;
	const observer = new MutationObserver(() => {
		clearTimeout(timer);
		timer = setTimeout(scan, 40);
	});

	observer.observe(document.documentElement, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ['title', 'style', 'class'],
	});

	allowImages();
	fixSortArrow();
	window.addEventListener('load', scan);
	[200, 800, 2000].forEach(delay => setTimeout(scan, delay));
	scan();
})();
