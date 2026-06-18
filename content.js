let hideOnPageLogs = false;

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

function startTaskExtraction() {
    const taskElement = document.querySelector('.formulation.clearfix');
    const contextElement = document.querySelector('.page-context-header.d-flex.flex-wrap.align-items-center.mb-2');
    
    if (!taskElement) {
        showResponseDiv("Nie znaleziono głównej treści zadania.");
        return;
    }

    const contextText = contextElement ? contextElement.innerText : "Ogólna wiedza";
    const taskText = taskElement.innerText;

    const inputs = taskElement.querySelectorAll('input[type="text"], input[type="number"], textarea, [contenteditable="true"]');
    const radios = taskElement.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    
    const hasInputs = inputs.length > 0;
    const hasRadios = radios.length > 0;
    
    const fieldType = hasRadios ? 'radio' : (hasInputs ? 'input' : 'text');

    showResponseDiv("AI analizuje i wypełnia zadanie...");
    
    chrome.runtime.sendMessage(
        { action: "fetchAI", text: taskText, context: contextText, fieldType: fieldType },
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
                handleAIResponse(response.reply, response.fieldType, inputs, radios);
            } else {
                showResponseDiv("Nieznany błąd podczas odbierania odpowiedzi.");
            }
        }
    );
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

function handleAIResponse(replyText, fieldType, inputs, radios) {
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

    } catch (e) {
        showResponseDiv("Model zwrócił format, którego nie udało się automatycznie wypełnić. Oto odpowiedź:\n\n" + replyText);
    }
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