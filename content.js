const SHOW_INLINE_BUTTONS = true;   // Pokazuje przyciski "Rozwiąż/Zweryfikuj" pod zadaniami
const SHOW_FLOATING_WINDOW = true;  // Pokazuje powiadomienia w prawym górnym rogu

async function getBase64Image(imgElement) {
    if (!imgElement) return null;
    if (!imgElement.complete) {
        await new Promise((resolve) => { imgElement.onload = resolve; imgElement.onerror = resolve; });
    }
    try {
        const canvas = document.createElement('canvas');
        canvas.width = imgElement.naturalWidth || imgElement.width || 500;
        canvas.height = imgElement.naturalHeight || imgElement.height || 500;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imgElement, 0, 0);
        return { mimeType: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.9).split(',')[1] };
    } catch (e) {
        try {
            const response = await fetch(imgElement.src);
            const blob = await response.blob();
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve({ mimeType: blob.type || "image/jpeg", data: reader.result.split(',')[1] });
                reader.readAsDataURL(blob);
            });
        } catch (err) { return null; }
    }
}

function isValidRadio(r) {
    if (r.id && r.id.includes('clearchoice')) return false;
    if (r.value === "-1") return false; 
    if (r.closest('.d-none, [hidden], .sr-only')) return false; 
    return true;
}

// Sprawdzanie czy udzielono odpowiedzi
function checkIsAnswered(taskElement) {
    const fillables = taskElement.querySelectorAll('input[type="text"], input[type="number"], textarea, div[contenteditable="true"], select');
    const radios = taskElement.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    let isAnswered = false;

    radios.forEach(r => { if (r.checked && isValidRadio(r)) isAnswered = true; });
    fillables.forEach(f => {
        if (f.tagName.toLowerCase() === 'select') {
            if (f.value && f.value !== "0" && f.value !== "-1" && f.selectedIndex > 0) isAnswered = true;
        } else if (f.hasAttribute('contenteditable')) {
            if (f.innerText.replace(/[\n\r]/g, '').trim() !== "") isAnswered = true;
        } else {
            if (f.value.trim() !== "") isAnswered = true;
        }
    });

    if (taskElement.querySelector('.correct, .incorrect, .partiallycorrect, .outcome')) isAnswered = true;
    return isAnswered;
}

function updateButtonState(btn, taskElement) {
    if (!btn) return;
    const isAnswered = checkIsAnswered(taskElement);
    btn.innerText = isAnswered ? '🔍 Zweryfikuj' : '🤖 Rozwiąż';
    btn.dataset.userMode = isAnswered ? 'verify' : 'solve';
    btn.style.backgroundColor = isAnswered ? '#eab308' : '#3b82f6';
    btn.onmouseover = () => { btn.style.backgroundColor = isAnswered ? '#ca8a04' : '#2563eb'; };
    btn.onmouseout = () => { btn.style.backgroundColor = isAnswered ? '#eab308' : '#3b82f6'; };
}

function injectButtons() {
    if (!SHOW_INLINE_BUTTONS) return; // Jeśli przyciski są wyłączone, przerywamy funkcję

    const tasks = document.querySelectorAll('.formulation.clearfix');

    tasks.forEach((taskElement) => {
        let btn = taskElement.querySelector('.ai-action-btn');
        const fillables = taskElement.querySelectorAll('input[type="text"], input[type="number"], textarea, div[contenteditable="true"], select');
        const radios = taskElement.querySelectorAll('input[type="radio"], input[type="checkbox"]');

        if (!taskElement.dataset.listenersAdded) {
            radios.forEach(r => {
                r.addEventListener('change', () => updateButtonState(taskElement.querySelector('.ai-action-btn'), taskElement));
            });
            fillables.forEach(f => {
                const handleInput = () => updateButtonState(taskElement.querySelector('.ai-action-btn'), taskElement);
                f.addEventListener('input', handleInput);
                f.addEventListener('change', handleInput);
                if (f.hasAttribute('contenteditable')) f.addEventListener('keyup', handleInput);
            });
            taskElement.dataset.listenersAdded = "true";
        }

        if (btn) {
            updateButtonState(btn, taskElement);
            return;
        }

        btn = document.createElement('button');
        btn.type = 'button'; 
        btn.className = 'ai-action-btn';
        Object.assign(btn.style, {
            margin: '10px 0', padding: '8px 16px', color: '#ffffff', border: 'none',
            borderRadius: '6px', cursor: 'pointer', fontWeight: '600',
            fontFamily: 'Segoe UI, sans-serif', fontSize: '13px', display: 'block', transition: 'background 0.2s'
        });

        updateButtonState(btn, taskElement);

        btn.addEventListener('click', async (e) => {
            e.preventDefault(); e.stopPropagation(); 
            const currentFillables = Array.from(taskElement.querySelectorAll('input[type="text"], input[type="number"], textarea, div[contenteditable="true"], select'));
            const allRadios = Array.from(taskElement.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
            const validRadios = allRadios.filter(isValidRadio);

            await handleTaskAnalysis(taskElement, btn.dataset.userMode, currentFillables, validRadios, btn);
        });
        taskElement.appendChild(btn);
    });
}

// Obsługa wywołania ze skrótu klawiszowego (przechwytuje żądanie z background.js)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "startAnalysis") {
        const tasks = document.querySelectorAll('.formulation.clearfix');
        if (tasks.length === 0) {
            showResponseDiv("Brak zadań do rozwiązania na tej stronie.");
            return;
        }

        // Uruchamiamy analizę dla wszystkich widocznych zadań (lub pierwszego, w zależności od potrzeb Moodle)
        tasks.forEach(async (taskElement) => {
            const isAnswered = checkIsAnswered(taskElement);
            const userMode = isAnswered ? 'verify' : 'solve';
            
            const currentFillables = Array.from(taskElement.querySelectorAll('input[type="text"], input[type="number"], textarea, div[contenteditable="true"], select'));
            const allRadios = Array.from(taskElement.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
            const validRadios = allRadios.filter(isValidRadio);
            const btn = taskElement.querySelector('.ai-action-btn'); // Może być null, jeśli przyciski są wyłączone

            await handleTaskAnalysis(taskElement, userMode, currentFillables, validRadios, btn);
        });
    }
});

async function handleTaskAnalysis(taskElement, userMode, fillables, validRadios, btnElement) {
    const contextElement = document.querySelector('.page-context-header.d-flex.flex-wrap.align-items-center.mb-2');
    const contextText = contextElement ? contextElement.innerText : "Ogólna wiedza";
    
    let trackingText = "TREŚĆ ZADANIA:\n---\n" + taskElement.innerText.trim() + "\n---\n\n";
    
    if (validRadios.length > 0) {
        trackingText += "OPCJE WYBORU (Zwróć same numery opcji w tablicy 'answers'):\n";
        validRadios.forEach((r, idx) => {
            let labelText = "";
            if (r.id) {
                const label = taskElement.querySelector(`label[for="${r.id}"]`);
                if (label) labelText = label.innerText.trim();
            }
            if (!labelText) labelText = r.parentNode.innerText.trim();
            trackingText += `Opcja nr ${idx + 1}: "${labelText.replace(/\n/g, ' ').replace(/\s+/g, ' ')}"\n`;
        });
        trackingText += "\n";
    }

    if (fillables.length > 0) {
        trackingText += "POLA DO UZUPEŁNIENIA (Zwróć w formacie JSON klucze 'ans1', 'ans2' itp.):\n";
        fillables.forEach((el, idx) => {
            if (el.tagName.toLowerCase() === 'select') {
                const options = Array.from(el.options).map(o => o.text.trim()).filter(t => t && t !== 'Wybierz...' && t !== 'Choose...').join(' | ');
                trackingText += `Pole nr ${idx + 1} (Lista rozwijana). Dostępne opcje to: [${options}]. Podaj jako 'ans${idx+1}' DOKŁADNY TEKST wybranej opcji.\n`;
            } else if (el.hasAttribute('contenteditable') || el.tagName.toLowerCase() === 'textarea') {
                trackingText += `Pole nr ${idx + 1} (Dłuższe wypracowanie/esej). Napisz odpowiedź i zwróć jako 'ans${idx+1}'.\n`;
            } else {
                trackingText += `Pole nr ${idx + 1} (Krótki tekst/liczba). Zwróć jako 'ans${idx+1}'.\n`;
            }
        });
    }

    showResponseDiv(userMode === 'verify' ? "Sprawdzam poprawność i analizuję pliki..." : "AI rozwiązuje zadanie i przetwarza grafikę...");

    const imgElement = taskElement.querySelector('img');
    const imageData = await getBase64Image(imgElement);

    const fieldType = (validRadios.length > 0) ? 'radio' : 'input';

    chrome.runtime.sendMessage(
        { 
            action: "fetchAI", text: trackingText, context: contextText, 
            fieldType: fieldType, imageData: imageData, mode: 'solve' 
        },
        (response) => {
            if (chrome.runtime.lastError) { showResponseDiv("Błąd komunikacji z procesem w tle."); return; }
            if (response && response.error) { showResponseDiv("Błąd: " + response.error); return; }
            if (response && response.reply) {
                processJsonAction(response.reply, fieldType, fillables, validRadios, taskElement, btnElement, userMode);
            } else { showResponseDiv("Nieznany błąd odpowiedzi."); }
        }
    );
}

function processJsonAction(replyText, fieldType, fillables, validRadios, taskElement, btnElement, userMode) {
    let cleanJsonString = replyText.replace(/```json/g, '').replace(/```/g, '').trim();
    const jsonStartIndex = cleanJsonString.indexOf('{');
    const jsonEndIndex = cleanJsonString.lastIndexOf('}');
    if (jsonStartIndex !== -1 && jsonEndIndex !== -1) cleanJsonString = cleanJsonString.substring(jsonStartIndex, jsonEndIndex + 1);

    try {
        const aiData = JSON.parse(cleanJsonString);

        if (userMode === 'solve') {
            applyAiDataToForm(aiData, fillables, validRadios);
            showResponseDiv("Pomyślnie uzupełniono zadanie.");
            updateButtonState(btnElement, taskElement);
            
        } else if (userMode === 'verify') {
            let isCorrect = true;

            if (validRadios.length > 0 && aiData.answers) {
                const userAnswers = [];
                validRadios.forEach((r, idx) => { if (r.checked) userAnswers.push(idx + 1); });
                if ([...userAnswers].sort().join(',') !== [...aiData.answers].sort().join(',')) {
                    isCorrect = false;
                }
            } 
            
            if (fillables.length > 0) {
                Object.keys(aiData).forEach(key => {
                    const match = key.match(/\d+/);
                    if (match) {
                        const idx = parseInt(match[0]) - 1;
                        const el = fillables[idx];
                        if (el) {
                            const aiVal = String(aiData[key]).trim().toLowerCase();
                            let userVal = "";
                            
                            if (el.tagName.toLowerCase() === 'select') {
                                userVal = el.options[el.selectedIndex] ? el.options[el.selectedIndex].text.trim().toLowerCase() : "";
                            } else if (el.hasAttribute('contenteditable')) {
                                userVal = el.innerText.trim().toLowerCase();
                            } else {
                                userVal = el.value.trim().toLowerCase();
                            }
                            
                            if (userVal !== aiVal) isCorrect = false;
                        }
                    }
                });
            }

            if (isCorrect) {
                showResponseDiv("🎉 Brawo! Odpowiedź jest całkowicie poprawna.");
                updateButtonState(btnElement, taskElement);
            } else {
                // BRAK MODALA NA ŚRODKU!
                // Wypuszczamy komunikat do bocznego okna i automatycznie zamieniamy odpowiedzi na właściwe
                showResponseDiv("⚠️ Wykryto błędną odpowiedź! Została automatycznie nadpisana.");
                applyAiDataToForm(aiData, fillables, validRadios);
                setTimeout(() => updateButtonState(btnElement, taskElement), 100);
            }
        }
    } catch (e) {
        showResponseDiv("Model zwrócił odpowiedź, której nie da się automatycznie wypełnić:\n\n" + replyText);
    }
}

function applyAiDataToForm(aiData, fillables, validRadios) {
    if (aiData.answers && validRadios.length > 0) {
        validRadios.forEach(r => { r.checked = false; r.dispatchEvent(new Event('change', { bubbles: true })); });
        aiData.answers.forEach(ansNum => {
            const index = parseInt(ansNum) - 1;
            if (validRadios[index]) {
                validRadios[index].checked = true;
                validRadios[index].dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
    }

    if (fillables.length > 0) {
        Object.keys(aiData).forEach((key) => {
            const match = key.match(/\d+/);
            if (match) {
                const index = parseInt(match[0]) - 1;
                const el = fillables[index];
                if (el) {
                    const val = aiData[key];
                    if (el.tagName.toLowerCase() === 'select') {
                        const option = Array.from(el.options).find(o => o.text.trim().toLowerCase() === String(val).trim().toLowerCase());
                        if (option) {
                            el.value = option.value;
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    } else if (el.hasAttribute('contenteditable')) {
                        el.innerText = val;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                    } else {
                        el.value = val;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
            }
        });
    }
}

function showResponseDiv(text) {
    // Jeśli okienko ma być wyłączone, wysyłamy log do konsoli przeglądarki (F12)
    if (!SHOW_FLOATING_WINDOW) {
        console.log("[Web AI Reader]:", text);
        return;
    }

    let resultDiv = document.getElementById('ai-extension-result');
    if (!resultDiv) {
        resultDiv = document.createElement('div');
        resultDiv.id = 'ai-extension-result';
        Object.assign(resultDiv.style, {
            position: 'fixed', top: '20px', right: '20px', width: '350px',
            maxHeight: '80vh', overflowY: 'auto', backgroundColor: '#1e293b', color: '#f8fafc', 
            border: '2px solid #38bdf8', borderRadius: '12px', padding: '20px', 
            zIndex: '999999', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', fontFamily: 'Segoe UI, sans-serif', fontSize: '14px', lineHeight: '1.6'
        });
        document.body.appendChild(resultDiv);
    }
    resultDiv.innerText = text;
}

if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', injectButtons); } 
else { injectButtons(); }
window.addEventListener('load', injectButtons);