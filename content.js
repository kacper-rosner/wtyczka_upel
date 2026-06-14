// Filtr odrzucający techniczne śmieci Moodle'a
function isValidRadio(r) {
    if (r.id && r.id.includes('clearchoice')) return false;
    if (r.value === "-1") return false; 
    if (r.closest('.d-none, [hidden], .sr-only')) return false; 
    return true;
}

// Sprawdzanie, czy udzielono odpowiedzi
function checkIsAnswered(taskElement) {
    const inputs = taskElement.querySelectorAll('input[type="text"], input[type="number"]');
    const radios = taskElement.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    
    let isAnswered = false;

    radios.forEach(r => { 
        if (r.checked && isValidRadio(r)) { 
            isAnswered = true; 
        } 
    });

    inputs.forEach(i => { 
        if (i.value.trim() !== "") { 
            isAnswered = true; 
        } 
    });

    if (taskElement.querySelector('.correct, .incorrect, .partiallycorrect, .outcome')) {
        isAnswered = true;
    }
    
    return isAnswered;
}

// Aktualizacja przycisku
function updateButtonState(btn, taskElement) {
    if (!btn) return;
    const isAnswered = checkIsAnswered(taskElement);
    
    btn.innerText = isAnswered ? '🔍 Zweryfikuj' : '🤖 Rozwiąż';
    btn.dataset.userMode = isAnswered ? 'verify' : 'solve';
    btn.style.backgroundColor = isAnswered ? '#eab308' : '#3b82f6';
    
    btn.onmouseover = () => { btn.style.backgroundColor = isAnswered ? '#ca8a04' : '#2563eb'; };
    btn.onmouseout = () => { btn.style.backgroundColor = isAnswered ? '#eab308' : '#3b82f6'; };
}

// Wstrzykiwanie przycisków
function injectButtons() {
    const tasks = document.querySelectorAll('.formulation.clearfix');

    tasks.forEach((taskElement) => {
        let btn = taskElement.querySelector('.ai-action-btn');
        const inputs = taskElement.querySelectorAll('input[type="text"], input[type="number"]');
        const radios = taskElement.querySelectorAll('input[type="radio"], input[type="checkbox"]');

        if (!taskElement.dataset.listenersAdded) {
            radios.forEach(r => {
                r.addEventListener('change', () => {
                    let currentBtn = taskElement.querySelector('.ai-action-btn');
                    updateButtonState(currentBtn, taskElement);
                });
            });
            inputs.forEach(i => {
                const handleInput = () => {
                    let currentBtn = taskElement.querySelector('.ai-action-btn');
                    updateButtonState(currentBtn, taskElement);
                };
                i.addEventListener('input', handleInput);
                i.addEventListener('change', handleInput);
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
            margin: '10px 0',
            padding: '8px 16px',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: '600',
            fontFamily: 'Segoe UI, sans-serif',
            fontSize: '13px',
            display: 'block',
            transition: 'background 0.2s'
        });

        updateButtonState(btn, taskElement);

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation(); 
            
            const currentInputs = Array.from(taskElement.querySelectorAll('input[type="text"], input[type="number"]'));
            const allRadios = Array.from(taskElement.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
            const validRadios = allRadios.filter(isValidRadio);

            handleTaskAnalysis(taskElement, btn.dataset.userMode, currentInputs, validRadios, btn);
        });

        taskElement.appendChild(btn);
    });
}

// Główna logika wysyłająca polecenie
function handleTaskAnalysis(taskElement, userMode, inputs, validRadios, btnElement) {
    const contextElement = document.querySelector('.page-context-header.d-flex.flex-wrap.align-items-center.mb-2');
    const contextText = contextElement ? contextElement.innerText : "Ogólna wiedza";
    
    // Zawsze prosimy model tylko o rozwiązanie (bez trybu oceniania)
    let trackingText = "TREŚĆ ZADANIA:\n---\n" + taskElement.innerText.trim() + "\n---\n\n";
    
    if (validRadios.length > 0) {
        trackingText += "DOSTĘPNE OPCJE WYBORU (Zwróć w JSON same numery opcji odpowiadających prawdzie):\n";
        validRadios.forEach((r, idx) => {
            let labelText = "";
            if (r.id) {
                const label = taskElement.querySelector(`label[for="${r.id}"]`);
                if (label) labelText = label.innerText.trim();
            }
            if (!labelText) labelText = r.parentNode.innerText.trim();
            labelText = labelText.replace(/\n/g, ' ').replace(/\s+/g, ' ');
            trackingText += `Opcja nr ${idx + 1}: "${labelText}"\n`;
        });
    }

    const imgElement = taskElement.querySelector('img');
    const imgUrl = imgElement ? imgElement.src : null;

    const hasInputs = inputs.length > 0;
    const hasRadios = validRadios.length > 0;
    const fieldType = hasRadios ? 'radio' : (hasInputs ? 'input' : 'text');

    showResponseDiv(userMode === 'verify' ? "Sprawdzam poprawność..." : "AI rozwiązuje zadanie...");

    chrome.runtime.sendMessage(
        { 
            action: "fetchAI", 
            text: trackingText, 
            context: contextText, 
            fieldType: fieldType,
            imageUrl: imgUrl,
            // CELOWO OSZUKUJEMY BACKGROUND.JS WYSYŁAJĄC ZAWSZE 'solve', ABY OTRZYMAĆ JSON
            mode: 'solve' 
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
                processJsonAction(response.reply, fieldType, inputs, validRadios, taskElement, btnElement, userMode);
            } else {
                showResponseDiv("Nieznany błąd podczas odbierania odpowiedzi.");
            }
        }
    );
}

// Główny dekoder - wykonuje akcje dla obu trybów w czystym JavaScriptcie
function processJsonAction(replyText, fieldType, inputs, validRadios, taskElement, btnElement, userMode) {
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

        if (userMode === 'solve') {
            // TRYB 1: ROZWIĄZYWANIE (Aplikujemy JSON od razu)
            applyAiDataToForm(aiData, fieldType, inputs, validRadios);
            showResponseDiv("Pomyślnie uzupełniono zadanie.");
            updateButtonState(btnElement, taskElement);
            
        } else if (userMode === 'verify') {
            // TRYB 2: WERYFIKACJA (JavaScript porównuje stany, ignorując model językowy)
            let isCorrect = true;
            let explanationText = "";

            if (fieldType === 'radio' && aiData.answers) {
                // Sprawdzamy co zaznaczył użytkownik
                const userAnswers = [];
                validRadios.forEach((r, idx) => { if (r.checked) userAnswers.push(idx + 1); });

                // Porównanie dwóch tablic numerków (np. zaznaczone [2] vs model uważa [2])
                const sortedUser = [...userAnswers].sort().join(',');
                const sortedAI = [...aiData.answers].sort().join(',');

                if (sortedUser === sortedAI) {
                    isCorrect = true;
                } else {
                    isCorrect = false;
                    // Składamy tekst do okna błędu
                    let correctLabels = aiData.answers.map(ansNum => {
                        const idx = parseInt(ansNum) - 1;
                        if(validRadios[idx]) {
                            let labelText = "";
                            if (validRadios[idx].id) {
                                const label = taskElement.querySelector(`label[for="${validRadios[idx].id}"]`);
                                if (label) labelText = label.innerText.trim();
                            }
                            if (!labelText) labelText = validRadios[idx].parentNode.innerText.trim();
                            return `• ${labelText.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()}`;
                        }
                        return `• Opcja nr ${ansNum}`;
                    });
                    explanationText = correctLabels.join('\n\n');
                }
            } 
            else if (fieldType === 'input') {
                let allMatch = true;
                let aiSuggested = [];
                
                Object.keys(aiData).forEach(key => {
                    const match = key.match(/\d+/);
                    if (match) {
                        const idx = parseInt(match[0]) - 1;
                        if (inputs[idx]) {
                            const aiVal = String(aiData[key]).trim().toLowerCase();
                            const userVal = inputs[idx].value.trim().toLowerCase();
                            aiSuggested.push(`Prawidłowo w polu nr ${idx + 1}: ${aiData[key]}`);
                            if (userVal !== aiVal) {
                                allMatch = false;
                            }
                        }
                    }
                });

                if (!allMatch) {
                    isCorrect = false;
                    explanationText = aiSuggested.join('\n');
                }
            }

            // Podjęcie decyzji na ekranie
            if (isCorrect) {
                showResponseDiv("🎉 Brawo! Odpowiedź jest całkowicie poprawna.");
                updateButtonState(btnElement, taskElement);
            } else {
                showCenterModal(explanationText, () => {
                    applyAiDataToForm(aiData, fieldType, inputs, validRadios);
                    setTimeout(() => updateButtonState(btnElement, taskElement), 100);
                });
            }
        }
    } catch (e) {
        showResponseDiv("Model zwrócił wynik, którego nie da się sprawdzić automatycznie:\n\n" + replyText);
    }
}

// Funkcja pomocnicza: wstrzykiwanie danych do HTMLa
function applyAiDataToForm(aiData, fieldType, inputs, validRadios) {
    if (fieldType === 'radio' && aiData.answers) {
        validRadios.forEach(r => {
            r.checked = false;
            r.dispatchEvent(new Event('change', { bubbles: true }));
        });
        
        aiData.answers.forEach(ansNum => {
            const index = parseInt(ansNum) - 1;
            if (validRadios[index]) {
                validRadios[index].checked = true;
                validRadios[index].dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
    }

    if (fieldType === 'input') {
        Object.keys(aiData).forEach((key) => {
            const match = key.match(/\d+/);
            if (match) {
                const index = parseInt(match[0]) - 1;
                if (inputs[index]) {
                    inputs[index].value = aiData[key];
                    inputs[index].dispatchEvent(new Event('input', { bubbles: true }));
                    inputs[index].dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        });
    }
}

// Okna pomocnicze
function showResponseDiv(text) {
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

// Zaktualizowane okienko błędu weryfikacji
function showCenterModal(explanationText, onReplace) {
    const oldModal = document.getElementById('ai-center-modal');
    if (oldModal) oldModal.remove();

    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'ai-center-modal';
    Object.assign(modalOverlay.style, {
        position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
        backgroundColor: 'rgba(15, 23, 42, 0.7)', zIndex: '1000000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'Segoe UI, sans-serif'
    });

    const modalBox = document.createElement('div');
    Object.assign(modalBox.style, {
        backgroundColor: '#1e293b', color: '#f8fafc', width: '500px',
        padding: '25px', borderRadius: '16px', border: '2px solid #ef4444',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)', display: 'flex',
        flexDirection: 'column', gap: '15px'
    });

    const title = document.createElement('h3');
    title.innerText = '⚠️ O nie! Model rozwiązałby to inaczej:';
    title.style.color = '#f87171';
    title.style.margin = '0';

    const content = document.createElement('div');
    content.innerText = explanationText; // Wrzucamy tu czysty, złożony w JS tekst podpowiedzi!
    content.style.fontSize = '14px';
    content.style.lineHeight = '1.6';
    content.style.maxHeight = '250px';
    content.style.overflowY = 'auto';

    const btnContainer = document.createElement('div');
    btnContainer.style.display = 'flex';
    btnContainer.style.justifyContent = 'flex-end';
    btnContainer.style.gap = '10px';

    const btnKeep = document.createElement('button');
    btnKeep.type = 'button';
    btnKeep.innerText = 'Zostaw moją odpowiedź';
    Object.assign(btnKeep.style, {
        padding: '8px 16px', backgroundColor: '#475569', color: '#fff',
        border: 'none', borderRadius: '6px', cursor: 'pointer'
    });
    btnKeep.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        modalOverlay.remove();
    });

    const btnReplace = document.createElement('button');
    btnReplace.type = 'button';
    btnReplace.innerText = 'Zamień na to!';
    Object.assign(btnReplace.style, {
        padding: '8px 16px', backgroundColor: '#10b981', color: '#fff',
        border: 'none', borderRadius: '6px', cursor: 'pointer'
    });
    btnReplace.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onReplace();
        modalOverlay.remove();
    });

    btnContainer.appendChild(btnKeep);
    btnContainer.appendChild(btnReplace);
    modalBox.appendChild(title);
    modalBox.appendChild(content);
    modalBox.appendChild(btnContainer);
    modalOverlay.appendChild(modalBox);
    document.body.appendChild(modalOverlay);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectButtons);
} else {
    injectButtons();
}
window.addEventListener('load', injectButtons);