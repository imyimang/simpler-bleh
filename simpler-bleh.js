// ==UserScript==
// @name         simpler bleh
// @namespace    https://github.com/imyimang/simpler-bleh
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

	const PROCESSED = 'data-bleh-simpler';
	const TITLE_MARKER = 'data-bleh-simpler-title';
	const CSP_MARKER = 'data-bleh-simpler-csp';
	const FETCH_MARKER = 'data-bleh-simpler-fetched';
	const COMPAT_MARKER = 'data-bleh-simpler-compat';
	const IMAGE_WRAPPER_MARKER = 'data-bleh-simpler-image-wrapper';
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
	const SHOUT_MARKDOWN = {
		allowHeaders: false,
		allowLists: false,
		allowAlignment: false,
		allowFonts: false,
		allowHue: false,
		allowBanners: false,
		allowIcons: false,
		allowSocials: false,
		startingHeader: 5,
	};
	const ABOUT_MARKDOWN = {
		allowHeaders: true,
		allowLists: true,
		allowAlignment: true,
		allowFonts: true,
		allowHue: true,
		allowBanners: true,
		allowIcons: true,
		allowSocials: true,
		startingHeader: 3,
	};
	const SOCIAL_LABELS = {
		lastfm: 'last.fm',
		twitter: 'X',
		x: 'X',
		mastodon: 'Mastodon',
		bluesky: 'Bluesky',
		tumblr: 'Tumblr',
		instagram: 'Instagram',
		facebook: 'Facebook',
		youtube: 'YouTube',
		spotify: 'Spotify',
		soundcloud: 'SoundCloud',
		steam: 'Steam',
		discord: 'Discord',
		websites: 'Website',
	};
	const markdownSignal = /\[(?:url|artist|album|track|font|left|center|right|links|banner|accent|name|status)\b[^\]]*\]|\[\/(?:url|artist|album|track|left|center|right|links)\]|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|https?:\/\/|www\.|@[a-z0-9_]+|`[^`]+`|\*\*[^*]+\*\*|~~[^~]+~~|__[^_]+__|_[^_\n]+_|:hazelfae:|🙏\s*BLESS\s*🙏|^#{1,6}\s|^>\s|^\s*(?:[-*+]\s|\d+\.\s)|\n/im;

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

	function renderMarkdown(source, options = SHOUT_MARKDOWN) {
		const stash = [];
		const blockStash = new Set();
		const socials = [];
		const hold = (html, block = false) => {
			const key = stash.push(html) - 1;
			if (block) blockStash.add(key);
			return `\u0000${key}\u0000`;
		};
		const restore = html => {
			let result = html;
			for (let pass = 0; pass < 8; pass += 1) {
				result = result.replace(/\u0000(\d+)\u0000/g, (_, index) => stash[Number(index)] || '');
			}
			return result;
		};
		const renderSocials = () => socials.length
			? `<div class="social-links-container">${socials.join('')}</div>`
			: '';

		let text = String(source).replace(/\r\n?/g, '\n');
		const leadingIndent = /^[ \t]*/.exec(text)[0].length;
		if (leadingIndent) {
			text = text.replace(new RegExp(`^[ \\t]{0,${leadingIndent}}`, 'gm'), '');
		}
		text = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');

		text = text.replace(
			/\[artist\]([\s\S]*?)\[\/artist\]/gi,
			(_, name) => link(`${ROOT}/music/${encodeURI(name.trim())}`, name.trim())
		);
		text = text.replace(
			/\[album artist=([^\]\n]+)\]([\s\S]*?)\[\/album\]/gi,
			(_, artist, album) =>
				link(
					`${ROOT}/music/${encodeURI(artist.trim())}/${encodeURI(album.trim())}`,
					album.trim()
				)
		);
		text = text.replace(
			/\[track artist=([^\]\n]+)\]([\s\S]*?)\[\/track\]/gi,
			(_, artist, track) =>
				link(
					`${ROOT}/music/${encodeURI(artist.trim())}/_/${encodeURI(track.trim())}`,
					track.trim()
				)
		);
		text = text.replace(
			/\[url=([^\]\n]+)\]([\s\S]*?)\[\/url\]/gi,
			(_, url, label) => link(url, label)
		);
		text = text.replace(
			/\[url\]([\s\S]*?)\[\/url\]/gi,
			(_, url) => link(url, url.trim())
		);

		if (options.allowSocials) {
			text = text.replace(
				/\[links\]\n?([\s\S]*?)\n?\[\/links\]/gi,
				(_, inner) => {
					[...inner.matchAll(/\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
						.forEach(([, label, url]) => {
							const href = safeUrl(url);
							if (!href) return;
							socials.push(
								`<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer"><span>${escapeHtml(label)}</span></a>`
							);
						});
					return '';
				}
			);
		}

		text = text.replace(
			/!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
			(_, alt, url, title) => {
				const src = safeUrl(url);
				if (!src) return '';
				return hold(
					`<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${
						title ? ` title="${escapeAttr(title)}"` : ''
					} loading="lazy">`
				);
			}
		);
		text = text.replace(
			/\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
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

		if (options.allowAlignment) {
			text = text.replace(
				/\[(left|center|right)\]\n?([\s\S]*?)\n?\[\/\1\]/gi,
				(_, align, inner) =>
					hold(
						`<div class="text-${align.toLowerCase()}">${
							renderMarkdown(inner, options).html.replace(/<\/?p>/g, '')
						}</div>`,
						true
					)
			);
		}

		if (options.allowBanners) text = text.replace(/\[banner=[^\]\n]*\]/gi, '');
		if (options.allowHue) text = text.replace(/\[(?:accent|name)=[^\]\n]*\]/gi, '');
		if (options.allowIcons) {
			text = text.replace(/\[status=[^\]\n]*\]/gi, '');
			text = text.replace(
				/:hazelfae:/gi,
				'<img src="https://katelyynn.github.io/bleh/assets/hazelfae.png" alt="hazelfae" class="emoji">'
			);
			text = text.replace(
				/🙏\s*BLESS\s*🙏/gi,
				'<img src="https://katelyynn.github.io/bleh/assets/bless.png" alt="BLESS" class="emoji">'
			);
		}
		if (options.allowFonts) {
			text = text.replace(/\[font=[^\]\n]*\]/gi, '');
			text = text.replace(/\[\/font\]/gi, '');
		}
		if (options.allowSocials) {
			text = text.replace(/\[links=([^\]\n]*)\]/gi, (_, value) => {
				value.split(/[\s,]+/).filter(Boolean).forEach(entry => {
					const separator = entry.indexOf(':');
					if (separator < 0) return;
					const name = entry.slice(0, separator).toLowerCase();
					const handle = entry.slice(separator + 1);
					if (!handle) return;
					const label = SOCIAL_LABELS[name] || name;
					const href = name === 'lastfm'
						? `${ROOT}/user/${encodeURI(handle)}`
						: `https://${name}.com/${encodeURI(handle)}`;
					socials.push(
						`<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer"><img src="https://icons.duckduckgo.com/ip3/${name}.ico" alt=""><span>${escapeHtml(label)}</span></a>`
					);
				});
				return '';
			});
			text = text.replace(/\[\/links\]/gi, '');
		}

		text = text.replace(
			/(^|[\s([{.,])@([a-z0-9_]{1,20})(?!@)(?=$|[^\w])/gi,
			(_, before, name) =>
				`${before}<a class="mention" href="${ROOT}/user/${name}">@${name}</a>`
		);

		text = text.replace(/<[^>\n]+>/g, match => hold(match));
		text = text.replace(
			/^((?: {4}|\t)[^\n]*(?:\n(?: {4}|\t)[^\n]*)*)/gm,
			block => {
				const lines = block.split('\n').map(line => line.replace(/^(?: {4}|\t)/, ''));
				return `\n${hold(
					`<pre><code>${escapeHtml(lines.join('\n'))}</code></pre>`,
					true
				)}\n`;
			}
		);
		text = text.replace(/`([^`\n]+)`/g, (_, code) =>
			hold(`<code>${escapeHtml(code)}</code>`)
		);

		const inlineFormat = value => {
			let result = value;
			result = result.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
			result = result.replace(/__([^_\n]+)__/g, '<u>$1</u>');
			result = result.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
			result = result.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
			result = result.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
			return result;
		};
		const blockPlaceholder = html => hold(html, true);
		const getBlockKey = line => {
			const match = /^\u0000(\d+)\u0000$/.exec(line.trim());
			return match && blockStash.has(Number(match[1])) ? match[1] : null;
		};

		const blocks = [];
		text.split(/\n{2,}/).forEach(chunk => {
			const lines = chunk.split('\n').filter(line => line.trim());
			if (!lines.length) return;

			if (lines.every(line => getBlockKey(line) !== null)) {
				blocks.push(lines.map(line => restore(line)).join(''));
				return;
			}

			const htmlLines = [];
			let currentList = null;
			let plainList = '';
			const flushList = () => {
				if (plainList) {
					htmlLines.push(plainList);
					plainList = '';
				}
				if (!currentList) return;
				htmlLines.push(`${currentList}</${currentList.startsWith('<ul') ? 'ul' : 'ol'}>`);
				currentList = null;
			};

			lines.forEach(line => {
				const trimmed = line.trim();
				const blockKey = getBlockKey(line);

				if (blockKey !== null) {
					flushList();
					htmlLines.push(line);
					return;
				}

				const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
				const unordered = /^[-*+]\s+(.*)$/.exec(trimmed);
				const ordered = /^\d+\.\s+(.*)$/.exec(trimmed);
				const quoted = /^&gt;\s+(.*)$/.exec(trimmed);

				if (heading && options.allowHeaders) {
					flushList();
					const level = Math.min(
						Math.max(options.startingHeader + heading[1].length - 1, 1),
						6
					);
					htmlLines.push(`<h${level}>${inlineFormat(heading[2])}</h${level}>`);
					return;
				}

				if ((unordered || ordered) && options.allowLists) {
					const type = unordered ? 'ul' : 'ol';
					if (!currentList || !currentList.startsWith(`<${type}>`)) {
						flushList();
						currentList = `<${type}>`;
					}
					currentList += `<li>${inlineFormat((unordered || ordered)[1])}</li>`;
					return;
				}

				if (quoted) {
					flushList();
					htmlLines.push(`<blockquote>${inlineFormat(quoted[1])}</blockquote>`);
					return;
				}

				if (heading && !options.allowHeaders) {
					flushList();
					htmlLines.push(
						heading[1].length === 1
							? `<p><strong>${inlineFormat(heading[2])}</strong></p>`
							: `<p>${inlineFormat(heading[2])}</p>`
					);
					return;
				}

				if ((unordered || ordered) && !options.allowLists) {
					plainList += inlineFormat((unordered || ordered)[1]);
					return;
				}

				flushList();
				htmlLines.push(inlineFormat(trimmed));
			});

			flushList();

			if (htmlLines.length === 1 && getBlockKey(htmlLines[0]) !== null) {
				blocks.push(restore(htmlLines[0]));
			} else {
				blocks.push(blockPlaceholder(`<p>${htmlLines.join('<br>')}</p>`));
			}
		});

		let html = restore(blocks.join(''));
		if (socials.length) html += renderSocials();
		html = html.replace(
			/<p>(Due to local laws, we are temporarily[\s\S]*?)<\/p>/g,
			(_, content) => `<p class="local-restriction">${content}</p>`
		);
		return { html };
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

	function renderInto(element, className, copyClasses, isAbout = false) {
		if (element.hasAttribute(PROCESSED)) return;
		element.setAttribute(PROCESSED, '');

		const source = element.textContent;
		if (!markdownSignal.test(source)) return;

		const { html } = renderMarkdown(source, isAbout ? ABOUT_MARKDOWN : SHOUT_MARKDOWN);
		if (!html) return;

		const container = document.createElement('div');
		container.className = 'bleh-simpler-markdown parsed-markdown markdown-body';
		if (copyClasses) {
			element.classList.forEach(name => container.classList.add(name));
		}
		if (className) container.classList.add(className);

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

		const restoreImageSize = image => {
			if (typeof getComputedStyle !== 'function') return;
			const style = getComputedStyle(image);
			if (style.width && style.width !== 'auto') image.style.width = style.width;
			if (style.height && style.height !== 'auto') image.style.height = style.height;
			if (style.maxWidth && style.maxWidth !== 'none') image.style.maxWidth = style.maxWidth;
			if (style.maxHeight && style.maxHeight !== 'none') image.style.maxHeight = style.maxHeight;
		};
		const wrapImage = image => {
			if (image.parentElement?.closest(`[${IMAGE_WRAPPER_MARKER}]`)) return;
			const wrapper = document.createElement('div');
			wrapper.className = 'markdown-image';
			wrapper.setAttribute(IMAGE_WRAPPER_MARKER, '');
			image.replaceWith(wrapper);
			wrapper.appendChild(image);
		};

		container.querySelectorAll('a').forEach(anchor => {
			anchor.classList.add('generic-link');
			if (!anchor.hasAttribute('target')) anchor.setAttribute('target', '_blank');
			if (!anchor.hasAttribute('rel')) anchor.setAttribute('rel', 'noopener noreferrer');
		});

		container.querySelectorAll('img').forEach(image => {
			const original = image.src;
			image.setAttribute('data-unsafe-href', encodeURI(original));
			restoreImageSize(image);
			wrapImage(image);
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
		marker.className = 'bleh-simpler-compat-percent';
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
		if (document.querySelector('style[data-bleh-simpler-sort-arrow]')) return;
		const style = document.createElement('style');
		style.setAttribute('data-bleh-simpler-sort-arrow', '');
		style.textContent = '#shoutbox-sort::before{left:auto!important;right:12px!important;transform:none!important;margin-left:0!important;margin-right:0!important}';
		(document.head || document.documentElement).appendChild(style);
	}

	function scan() {
		document.querySelectorAll(
			`.shout .shout-body p:not([${PROCESSED}]), .about-me-sidebar > p:not([${PROCESSED}])`
		).forEach(element => {
			const isAbout = element.parentElement?.classList
				.contains('about-me-sidebar');
			renderInto(element, isAbout ? 'about-me-content' : '', true, isAbout);
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
