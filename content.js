let hideOnPageLogs = false;
const MAX_IMAGES_TO_SEND = 6;

chrome.storage.local.get(['floatingBtn', 'hideOnPageLogs'], (result) => {
    hideOnPageLogs = result.hideOnPageLogs === true;
    if (result.floatingBtn === true) {
        injectFloatingButton();
    }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        if (changes.hideOnPageLogs) {
            hideOnPageLogs = changes.hideOnPageLogs.newValue === true;
            if (hideOnPageLogs) {
                const div = document.getElementById('ai-extension-result');
                if (div) div.remove();
            }
        }
        if (changes.floatingBtn) {
            if (changes.floatingBtn.newValue === true) {
                injectFloatingButton();
            } else {
                const btn = document.getElementById('ai-trigger-floating-btn');
                if (btn) btn.remove();
            }
        }
    }
});

function injectFloatingButton() {
    if (document.getElementById('ai-trigger-floating-btn')) return;
    
    const btn = document.createElement('button');
    btn.id = 'ai-trigger-floating-btn';
    btn.innerText = "Rozwiąż zadanie";
    
    Object.assign(btn.style, {
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        padding: '12px 20px',
        backgroundColor: '#38bdf8',
        color: '#fff',
        border: 'none',
        borderRadius: '50px',
        fontWeight: 'bold',
        fontSize: '14px',
        cursor: 'pointer',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        zIndex: '9999999',
        transition: '0.2s'
    });

    btn.addEventListener('mouseover', () => btn.style.backgroundColor = '#0284c7');
    btn.addEventListener('mouseout', () => btn.style.backgroundColor = '#38bdf8');
    btn.addEventListener('click', startTaskExtraction);
    
    document.body.appendChild(btn);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "startAnalysis") {
        startTaskExtraction();
    }
});

async function startTaskExtraction() {
    const taskElement = document.querySelector('.formulation.clearfix');
    const contextElement = document.querySelector('.page-context-header.d-flex.flex-wrap.align-items-center.mb-2');
    
    if (!taskElement) {
        showResponseDiv("Nie znaleziono głównej treści zadania.");
        return;
    }

    const contextText = contextElement ? contextElement.innerText : "Ogólna wiedza";
    const images = await extractImagesFromTask(taskElement);

    const inputs = taskElement.querySelectorAll('input[type="text"], input[type="number"], textarea, [contenteditable="true"]');
    const radios = taskElement.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    const selects = Array.from(taskElement.querySelectorAll('select')).filter(isUsableSelect);

    const hasInputs = inputs.length > 0;
    const hasRadios = radios.length > 0;
    const hasSelects = selects.length > 0;

    let taskText = addImageInfoToText(taskElement.innerText, images);
    if (hasSelects) {
        taskText += buildSelectsInfo(selects);
    }

    const fieldType = hasRadios ? 'radio' : (hasSelects ? 'select' : (hasInputs ? 'input' : 'text'));

    const questionSnapshot = buildQuestionSnapshot(taskElement, contextText, fieldType, images, inputs, radios, selects);
    saveQuestionSnapshotToStorage(questionSnapshot);

    showResponseDiv(
        images.length
            ? `AI analizuje treść, ${images.length} obrazek/obrazki i pola wyboru...`
            : (hasSelects ? "AI analizuje listy wyboru i zaraz je uzupełni..." : "AI analizuje treść zadania...")
    );
    
    chrome.runtime.sendMessage(
        {
            action: "fetchAI",
            text: taskText,
            context: contextText,
            fieldType: fieldType,
            images: images,
            imageData: images,
            questionSnapshot: questionSnapshot
        },
        (response) => {
            if (chrome.runtime.lastError) {
                showResponseDiv("Błąd komunikacji z procesem w tle.");
                return;
            }

            if (response && response.error) {
                showResponseDiv("Błąd: " + response.error);
                return;
            }

            if (response && response.reply) {
                handleAIResponse(response.reply, response.fieldType || fieldType, inputs, radios, selects);
            } else {
                showResponseDiv("Nieznany błąd podczas odbierania odpowiedzi.");
            }
        }
    );
}

async function extractImagesFromTask(taskElement) {
    const imgElements = Array.from(taskElement.querySelectorAll('img'));
    const uniqueUrls = new Set();
    const images = [];

    for (const img of imgElements) {
        if (images.length >= MAX_IMAGES_TO_SEND) break;

        const src = getImageSrc(img);
        if (!src || uniqueUrls.has(src) || shouldIgnoreImage(img, src)) continue;
        uniqueUrls.add(src);

        const dataUrl = await imageUrlToDataUrl(src);
        images.push({
            index: images.length + 1,
            src,
            dataUrl: dataUrl || null,
            image_url: dataUrl || src,
            alt: (img.alt || '').trim(),
            title: (img.title || '').trim(),
            width: img.naturalWidth || img.width || null,
            height: img.naturalHeight || img.height || null
        });
    }

    const backgroundUrls = findBackgroundImageUrls(taskElement);
    for (const src of backgroundUrls) {
        if (images.length >= MAX_IMAGES_TO_SEND) break;
        if (!src || uniqueUrls.has(src)) continue;
        uniqueUrls.add(src);

        const dataUrl = await imageUrlToDataUrl(src);
        if (!dataUrl) continue;

        images.push({
            index: images.length + 1,
            src,
            dataUrl,
            image_url: dataUrl,
            alt: '',
            title: 'background-image',
            width: null,
            height: null
        });
    }

    return images;
}

function getImageSrc(img) {
    const rawSrc =
        img.currentSrc ||
        img.src ||
        img.getAttribute('src') ||
        img.getAttribute('data-src') ||
        img.getAttribute('data-lazy-src') ||
        img.getAttribute('data-original') ||
        img.getAttribute('data-url');

    if (!rawSrc) return null;

    try {
        return new URL(rawSrc, window.location.href).href;
    } catch (e) {
        return rawSrc;
    }
}

function findBackgroundImageUrls(root) {
    const urls = [];
    const elements = Array.from(root.querySelectorAll('*'));

    for (const element of elements) {
        const backgroundImage = window.getComputedStyle(element).backgroundImage;
        if (!backgroundImage || backgroundImage === 'none') continue;

        const matches = backgroundImage.matchAll(/url\(["']?(.+?)["']?\)/g);
        for (const match of matches) {
            try {
                urls.push(new URL(match[1], window.location.href).href);
            } catch (e) {
                urls.push(match[1]);
            }
        }
    }

    return urls;
}

function shouldIgnoreImage(img, src) {
    const width = img.naturalWidth || img.width || img.clientWidth || 0;
    const height = img.naturalHeight || img.height || img.clientHeight || 0;
    const lowerSrc = src.toLowerCase();
    const lowerClass = String(img.className || '').toLowerCase();

    if (lowerSrc.includes('spacer') || lowerSrc.includes('blank') || lowerSrc.includes('pixel')) return true;
    if (lowerClass.includes('icon') && width <= 48 && height <= 48) return true;
    if (width > 0 && height > 0 && (width < 25 || height < 18)) return true;

    return false;
}

async function imageUrlToDataUrl(src) {
    if (src.startsWith('data:image/')) return src;

    try {
        const response = await fetch(src, { credentials: 'include' });
        if (!response.ok) return null;

        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) return null;

        if (blob.size > 1200000 || !['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) {
            const resized = await resizeImageBlobToDataUrl(blob);
            if (resized) return resized;
        }

        return await blobToDataUrl(blob);
    } catch (e) {
        return null;
    }
}

function resizeImageBlobToDataUrl(blob) {
    return new Promise((resolve) => {
        const objectUrl = URL.createObjectURL(blob);
        const image = new Image();

        image.onload = () => {
            const maxSide = 1600;
            const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(objectUrl);
            resolve(canvas.toDataURL('image/jpeg', 0.88));
        };

        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(null);
        };

        image.src = objectUrl;
    });
}

function blobToDataUrl(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
    });
}

function addImageInfoToText(text, images) {
    if (!images.length) return text;

    const imageInfo = images.map((img) => {
        const parts = [`Obrazek ${img.index}`];
        if (img.alt) parts.push(`alt: ${img.alt}`);
        if (img.title) parts.push(`title: ${img.title}`);
        if (img.width && img.height) parts.push(`rozmiar: ${img.width}x${img.height}`);
        if (!img.dataUrl) parts.push(`url: ${img.src}`);
        return parts.join(' | ');
    }).join('\n');

    return `${text}\n\nW zadaniu są obrazki. Uwzględnij je przy odpowiedzi:\n${imageInfo}`;
}


function isUsableSelect(select) {
    if (!select || select.disabled || select.options.length < 2) return false;

    const style = window.getComputedStyle(select);
    if (style.display === 'none' || style.visibility === 'hidden') return false;

    const rect = select.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;

    return true;
}

function buildSelectsInfo(selects) {
    const lines = [
        '',
        '--- POLA WYBORU / LISTY ROZWIJANE ---',
        'Dla każdego pola wybierz jedną poprawną opcję. Zwróć odpowiedzi w tej samej kolejności, w jakiej pola są wypisane poniżej.'
    ];

    selects.forEach((select, selectIndex) => {
        const promptText = getSelectPromptText(select) || `Pole wyboru ${selectIndex + 1}`;
        lines.push(`\nPole ${selectIndex + 1}: "${promptText}"`);
        lines.push('Opcje do wyboru:');

        getRealSelectOptions(select).forEach((option, optionIndex) => {
            lines.push(`${optionIndex + 1}. ${option.text} [value="${option.value}"]`);
        });
    });

    lines.push('--- KONIEC PÓL WYBORU ---');
    return '\n' + lines.join('\n');
}

function getRealSelectOptions(select) {
    return Array.from(select.options)
        .map((option, rawIndex) => ({
            rawIndex,
            value: option.value,
            text: cleanText(option.textContent || option.innerText || ''),
            disabled: option.disabled
        }))
        .filter(option => option.text && !option.disabled && !isPlaceholderOption(option));
}

function isPlaceholderOption(option) {
    const text = normalizeText(option.text);
    const value = String(option.value || '').trim();

    if (!text) return true;
    if (text === 'wybierz' || text === 'wybierz...' || text === 'choose' || text === 'select' || text === 'select...') return true;
    if (text.includes('wybierz') && text.length <= 20) return true;
    if ((value === '' || value === '0' || value === '-1') && /^(wybierz|choose|select|--|—|\.\.\.)/.test(text)) return true;

    return false;
}

function getSelectPromptText(select) {
    if (select.getAttribute('aria-label')) return cleanText(select.getAttribute('aria-label'));

    if (select.id && window.CSS && CSS.escape) {
        const label = document.querySelector(`label[for="${CSS.escape(select.id)}"]`);
        if (label) {
            const labelText = cleanText(label.innerText || label.textContent || '');
            if (labelText) return labelText;
        }
    }

    const parentLabel = select.closest('label');
    if (parentLabel) {
        const labelText = textWithoutControls(parentLabel);
        if (labelText) return labelText;
    }

    const row = select.closest('tr');
    if (row) {
        const rowText = textWithoutControls(row);
        if (rowText) return trimLong(rowText, 220);
    }

    const compactContainer = findCompactSelectContainer(select);
    if (compactContainer) {
        const containerText = textWithoutControls(compactContainer);
        if (containerText) return trimLong(containerText, 220);
    }

    const previous = getPreviousVisibleText(select);
    if (previous) return trimLong(previous, 160);

    return '';
}

function findCompactSelectContainer(select) {
    let current = select.parentElement;
    while (current && current !== document.body) {
        const text = textWithoutControls(current);
        const selectCount = current.querySelectorAll('select').length;

        if (text && text.length <= 220 && selectCount <= 3) {
            return current;
        }

        current = current.parentElement;
    }
    return null;
}

function textWithoutControls(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('select, option, input, textarea, button, script, style').forEach(node => node.remove());
    return cleanText(clone.innerText || clone.textContent || '');
}

function getPreviousVisibleText(element) {
    let node = element.previousSibling;
    const parts = [];

    while (node && parts.join(' ').length < 160) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = cleanText(node.textContent || '');
            if (text) parts.unshift(text);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const text = textWithoutControls(node);
            if (text) parts.unshift(text);
        }
        node = node.previousSibling;
    }

    return cleanText(parts.join(' '));
}

function cleanText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function normalizeText(text) {
    return cleanText(text)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[.,;:!?()[\]{}"'`´]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function trimLong(text, maxLength) {
    const cleaned = cleanText(text);
    return cleaned.length > maxLength ? cleaned.slice(0, maxLength - 3) + '...' : cleaned;
}

function forceSelectValue(select, answer) {
    const option = findBestSelectOption(select, answer);
    if (!option) return false;

    const nativeSelectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
    if (nativeSelectSetter) {
        nativeSelectSetter.call(select, option.value);
    } else {
        select.value = option.value;
    }

    select.selectedIndex = option.rawIndex;
    Array.from(select.options).forEach((opt, index) => {
        opt.selected = index === option.rawIndex;
    });

    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.dispatchEvent(new Event('blur', { bubbles: true }));

    return true;
}

function findBestSelectOption(select, answer) {
    const options = getRealSelectOptions(select);
    if (!options.length) return null;

    let rawAnswer = answer;
    if (rawAnswer && typeof rawAnswer === 'object') {
        rawAnswer = rawAnswer.text ?? rawAnswer.label ?? rawAnswer.value ?? rawAnswer.answer ?? rawAnswer.option ?? rawAnswer.index;
    }

    const answerString = cleanText(String(rawAnswer ?? ''));
    const normalizedAnswer = normalizeText(answerString);

    if (!answerString) return null;

    if (/^\d+$/.test(answerString)) {
        const number = parseInt(answerString, 10);
        if (options[number - 1]) return options[number - 1];

        const rawOption = Array.from(select.options)[number - 1];
        if (rawOption && !rawOption.disabled) {
            return {
                rawIndex: number - 1,
                value: rawOption.value,
                text: cleanText(rawOption.textContent || rawOption.innerText || ''),
                disabled: rawOption.disabled
            };
        }
    }

    let found = options.find(option => String(option.value) === answerString);
    if (found) return found;

    found = options.find(option => normalizeText(option.text) === normalizedAnswer);
    if (found) return found;

    found = options.find(option => {
        const optionText = normalizeText(option.text);
        return optionText.includes(normalizedAnswer) || normalizedAnswer.includes(optionText);
    });
    if (found) return found;

    return null;
}

function forceInputValue(element, value) {
    if (element.isContentEditable) {
        const htmlValue = value.replace(/\n/g, '<br>');
        element.innerHTML = htmlValue;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
        return;
    }

    element.value = value;
    element.setAttribute('value', value);
    
    const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    const nativeTextAreaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    
    if (nativeInputSetter && element instanceof HTMLInputElement) {
        nativeInputSetter.call(element, value);
    } else if (nativeTextAreaSetter && element instanceof HTMLTextAreaElement) {
        nativeTextAreaSetter.call(element, value);
    }
    
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
}

function forceRadioCheck(radio) {
    radio.checked = true;
    radio.setAttribute('checked', 'checked');
    
    const nativeRadioSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
    if (nativeRadioSetter) {
        nativeRadioSetter.call(radio, true);
    }
    
    radio.dispatchEvent(new Event('click', { bubbles: true }));
    radio.dispatchEvent(new Event('change', { bubbles: true }));
}

function handleAIResponse(replyText, fieldType, inputs, radios, selects = []) {
    if (fieldType === 'text') {
        showResponseDiv(replyText);
        return;
    }

    let cleanJsonString = replyText.replace(/```json/g, '').replace(/```/g, '').trim();
    const jsonStartIndex = cleanJsonString.indexOf('{');
    const jsonEndIndex = cleanJsonString.lastIndexOf('}');
    if (jsonStartIndex !== -1 && jsonEndIndex !== -1) {
        cleanJsonString = cleanJsonString.substring(jsonStartIndex, jsonEndIndex + 1);
    }

    try {
        const aiData = JSON.parse(cleanJsonString);
        
        chrome.storage.local.set({
            lastAiResponse: cleanJsonString,
            pdfRead: aiData.pdf_read === true
        });
        saveAiAnswerForLastQuestion(cleanJsonString);

        let actionLog = "Pomyślnie zdekodowano JSON.\n\n";
        
        if (fieldType === 'radio' && aiData.answers) {
            aiData.answers.forEach(ansNum => {
                const index = parseInt(ansNum) - 1;
                if (radios[index]) {
                    forceRadioCheck(radios[index]);
                }
            });
            actionLog += `Zaznaczono poprawne opcje: ${aiData.answers.join(', ')}`;
            showResponseDiv(actionLog);
        }

        if (fieldType === 'input') {
            let filledCount = 0;
            if (aiData.answers && Array.isArray(aiData.answers)) {
                aiData.answers.forEach((val, index) => {
                    if (inputs[index]) {
                        forceInputValue(inputs[index], val);
                        filledCount++;
                    }
                });
            } else {
                Object.keys(aiData).forEach((key) => {
                    const match = key.match(/\d+/);
                    if (match) {
                        const index = parseInt(match[0]) - 1;
                        if (inputs[index]) {
                            forceInputValue(inputs[index], aiData[key]);
                            filledCount++;
                        }
                    }
                });
            }
            actionLog += `Wypełniono ${filledCount} pól tekstowych/esejów.`;
            showResponseDiv(actionLog);
        }

        if (fieldType === 'select') {
            let filledCount = 0;
            const answers = Array.isArray(aiData.answers)
                ? aiData.answers
                : (Array.isArray(aiData.selects) ? aiData.selects : []);

            if (answers.length) {
                answers.forEach((val, index) => {
                    if (selects[index] && forceSelectValue(selects[index], val)) {
                        filledCount++;
                    }
                });
            } else {
                Object.keys(aiData).forEach((key) => {
                    const match = key.match(/\d+/);
                    if (match) {
                        const index = parseInt(match[0]) - 1;
                        if (selects[index] && forceSelectValue(selects[index], aiData[key])) {
                            filledCount++;
                        }
                    }
                });
            }

            actionLog += `Uzupełniono ${filledCount} list rozwijanych.`;
            showResponseDiv(actionLog);
        }

    } catch (e) {
        saveAiAnswerForLastQuestion(replyText);
        showResponseDiv("Model zwrócił format, którego nie udało się automatycznie wypełnić. Oto odpowiedź:\n\n" + replyText);
    }
}

function saveQuestionSnapshotToStorage(snapshot) {
    try {
        chrome.runtime.sendMessage({ action: 'saveQuestionSnapshot', snapshot }, () => {
            void chrome.runtime.lastError;
        });
    } catch (e) {}
}

function saveAiAnswerForLastQuestion(aiAnswer) {
    try {
        chrome.runtime.sendMessage({ action: 'updateLastQuestionAiAnswer', aiAnswer: String(aiAnswer || '') }, () => {
            void chrome.runtime.lastError;
        });
    } catch (e) {}
}

function buildQuestionSnapshot(taskElement, contextText, fieldType, images, inputs, radios, selects) {
    const questionText = textWithoutControls(taskElement) || cleanText(taskElement.innerText || taskElement.textContent || '');
    const rawText = cleanText(taskElement.innerText || taskElement.textContent || '');
    const choiceFields = buildRadioCheckboxChoices(radios);
    const selectFields = buildSelectSnapshot(selects);
    const imageInfo = (images || []).map((img) => ({
        index: img.index,
        src: img.src || '',
        alt: img.alt || '',
        title: img.title || '',
        width: img.width || null,
        height: img.height || null,
        hasInlineData: !!img.dataUrl
    }));

    const baseForFingerprint = [
        window.location.href,
        questionText,
        JSON.stringify(choiceFields),
        JSON.stringify(selectFields)
    ].join('|');

    return {
        pageTitle: document.title || '',
        pageUrl: window.location.href,
        context: cleanText(contextText || ''),
        fieldType,
        savedAt: new Date().toISOString(),
        questionText: trimToLimit(questionText, 12000),
        rawText: trimToLimit(rawText, 12000),
        textFieldCount: inputs ? inputs.length : 0,
        choiceFields,
        selectFields,
        imageInfo,
        fingerprint: makeSimpleHash(baseForFingerprint)
    };
}

function buildSelectSnapshot(selects) {
    return Array.from(selects || []).map((select, index) => ({
        label: getSelectPromptText(select) || `Pole wyboru ${index + 1}`,
        options: getRealSelectOptions(select).map((option, optionIndex) => ({
            number: optionIndex + 1,
            text: option.text,
            value: option.value
        }))
    })).filter(field => field.options.length > 0);
}

function buildRadioCheckboxChoices(radios) {
    const groups = [];
    const groupMap = new Map();

    Array.from(radios || []).forEach((input) => {
        if (!input || input.disabled) return;

        const type = input.type === 'checkbox' ? 'checkbox' : 'radio';
        const groupKey = input.name ? `${type}:${input.name}` : `${type}:single:${groups.length}`;

        if (!groupMap.has(groupKey)) {
            const group = {
                label: input.name || (type === 'checkbox' ? 'Pytanie checkbox' : 'Pytanie jednokrotnego wyboru'),
                type,
                choices: []
            };
            groupMap.set(groupKey, group);
            groups.push(group);
        }

        const group = groupMap.get(groupKey);
        group.choices.push({
            number: group.choices.length + 1,
            text: getInputChoiceText(input) || `Opcja ${group.choices.length + 1}`,
            value: input.value || ''
        });
    });

    return groups.filter(group => group.choices.length > 0);
}

function getInputChoiceText(input) {
    if (input.id && window.CSS && CSS.escape) {
        const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (label) {
            const labelText = textWithoutControls(label);
            if (labelText) return trimLong(labelText, 300);
        }
    }

    const parentLabel = input.closest('label');
    if (parentLabel) {
        const labelText = textWithoutControls(parentLabel);
        if (labelText) return trimLong(labelText, 300);
    }

    const row = input.closest('tr');
    if (row) {
        const rowText = textWithoutControls(row);
        if (rowText) return trimLong(rowText, 300);
    }

    let current = input.parentElement;
    let depth = 0;
    while (current && current !== document.body && depth < 4) {
        const text = textWithoutControls(current);
        if (text && text.length <= 300) return trimLong(text, 300);
        current = current.parentElement;
        depth++;
    }

    const nextText = getNextVisibleText(input);
    if (nextText) return trimLong(nextText, 300);

    return '';
}

function getNextVisibleText(element) {
    let node = element.nextSibling;
    const parts = [];

    while (node && parts.join(' ').length < 180) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = cleanText(node.textContent || '');
            if (text) parts.push(text);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const text = textWithoutControls(node);
            if (text) parts.push(text);
        }
        node = node.nextSibling;
    }

    return cleanText(parts.join(' '));
}

function trimToLimit(text, maxLength) {
    const cleaned = String(text || '');
    return cleaned.length > maxLength ? cleaned.slice(0, maxLength - 20) + '\n...[ucięto]' : cleaned;
}

function makeSimpleHash(text) {
    let hash = 0;
    const value = String(text || '');
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    }
    return `q_${Math.abs(hash)}`;
}

function showResponseDiv(text) {
    if (hideOnPageLogs) return;

    let resultDiv = document.getElementById('ai-extension-result');
    if (!resultDiv) {
        resultDiv = document.createElement('div');
        resultDiv.id = 'ai-extension-result';
        Object.assign(resultDiv.style, {
            position: 'fixed', top: '20px', right: '20px', width: '350px',
            maxHeight: '80vh', overflowY: 'auto', backgroundColor: '#1e293b',
            color: '#f8fafc', border: '2px solid #38bdf8', borderRadius: '12px',
            padding: '20px', zIndex: '999999', boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            fontFamily: 'Segoe UI, sans-serif', fontSize: '14px', lineHeight: '1.6'
        });
        document.body.appendChild(resultDiv);
    }
    resultDiv.innerText = text;
}
