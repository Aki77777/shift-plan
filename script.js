const ENABLE_SHIFT_REPORT = false;

// === Rotacije + smjene A/B + greške + izvještaj po smjenama ===

// Pozicije
const rotationOrder = ["1L", "2L", "3L", "4L", "1D", "2D", "3D", "4D", "5"];

// Status radnika (za budućnost)
const Status = { POSAO: "na_poslu", BOLOVANJE: "bolovanje", GODISNJI: "godisnji", SLOBODNO: "slobodan" };

// Radnici (objekti)
const workers = [
    { id: "w1", ime: "Ivana", status: Status.POSAO, sposobnePozicije: ["1L", "2L", "3L", "4L", "5"] },
    { id: "w2", ime: "Marko", status: Status.POSAO, sposobnePozicije: ["1L", "2L", "3L", "4L", "5"] },
    { id: "w3", ime: "Amar", status: Status.POSAO, sposobnePozicije: ["1L", "2L", "3L", "4L", "5"] },
    { id: "w4", ime: "Jasna", status: Status.POSAO, sposobnePozicije: ["1L", "2L", "3L", "4L", "5"] },
    { id: "w5", ime: "Lejla", status: Status.POSAO, sposobnePozicije: ["1L", "2L", "3L", "4L", "5"] },
    { id: "w6", ime: "Petar", status: Status.POSAO, sposobnePozicije: ["1L", "2L", "3L", "4L", "5"] },
    { id: "w7", ime: "Sara", status: Status.POSAO, sposobnePozicije: ["1L", "2L", "3L", "4L", "5"] },
    { id: "w8", ime: "Nermin", status: Status.POSAO, sposobnePozicije: ["1L", "2L", "3L", "4L", "5"] },
    { id: "w9", ime: "Aida", status: Status.POSAO, sposobnePozicije: ["5"] }
];

const workersMap = Object.fromEntries(workers.map(w => [w.id, w]));

// Početne dodjele po pozicijama
let assignment = {
    "1L": "w1", "2L": "w2", "3L": "w3", "4L": "w4",
    "1D": "w5", "2D": "w6", "3D": "w7", "4D": "w8",
    "5": "w9"
};

// ------------------------ Smjene i dan ------------------------
const SHIFT_ROUNDS = 5; // 5 rundi = 1 smjena
const days = ["Ponedjeljak", "Utorak", "Srijeda", "Četvrtak", "Petak", "Subota", "Nedjelja"];
let dayIndex = 0;
let shiftLetter = "A";    // A ili B
let roundInShift = 0;

const TOTAL_ROTATIONS_BEFORE_SUMMARY = 10; // demo prag za prikaz sažetka
let totalRotations = 0;

// ------------------------ Statistika pozicija ------------------------
let positionCounts = {};
for (const w of workers) {
    positionCounts[w.id] = {};
    for (const pos of rotationOrder) positionCounts[w.id][pos] = 0;
}

// ------------------------ Greške (ukupno) ------------------------
let errorCounts = {};
let errorLog = [];
for (const w of workers) {
    errorCounts[w.id] = {};
    for (const pos of rotationOrder) errorCounts[w.id][pos] = 0;
}

// ------------------------ Greške po smjenama ------------------------
let shiftsReport = []; // [{day, shift, errors}, ...]

// tvornička: prazna matrica workerId->pos->0
function makeEmptyMatrix() {
    const m = {};
    for (const w of workers) {
        m[w.id] = {};
        for (const pos of rotationOrder) m[w.id][pos] = 0;
    }
    return m;
}
// Trenutni akumulator grešaka unutar tekuće smjene
let currentShiftErrors = makeEmptyMatrix();

// ------------------------ Simulacija grešaka ------------------------
const POSITIONS_TO_CHECK = ["1L", "2L", "3L", "4L", "1D", "2D", "3D", "4D", "5"]; // uključena i 5
const ERR_EVENTS_PER_ROTATION = 2;
const ERROR_PROB = 0.4;
const ERRORS_MIN = 1;
const ERRORS_MAX = 2;

// ===== Standby radnici (izvan linije) =====
const standbyWorkers = [
    { id: "s1", ime: "Dario", uloga: "Voditelj smijene", status: Status.POSAO },
    { id: "s2", ime: "Matea", uloga: "Materijal", status: Status.SLOBODNO },
    { id: "s3", ime: "Luka", uloga: "Kvaliteta", status: Status.GODISNJI },
    { id: "s4", ime: "Ivo", uloga: "Održavanje", status: Status.BOLOVANJE },
    { id: "s5", ime: "Ena", uloga: "Rezerva", status: Status.POSAO }
];

// Render standby liste u sidebaru
function getInitials(fullName) {
    return fullName.split(/\s+/).map(p => p[0]).slice(0, 2).join("").toUpperCase();
}
function renderStandby() {
    const box = document.getElementById("standbyList");
    if (!box) return;
    box.innerHTML = standbyWorkers.map(sw => {
        return `
        <div class="standby-chip">
          <div class="avatar">${getInitials(sw.ime)}</div>
          <div class="person">
            <div class="name">${sw.ime}</div>
            <div class="role">${sw.uloga}</div>
          </div>
        </div>`;
    }).join("");
}

// Mapiranje status -> klasa lampice i tekst
function statusToLampClass(status) {
    switch (status) {
        case Status.POSAO: return "lamp--green";
        case Status.GODISNJI: return "lamp--red";
        case Status.SLOBODNO: return "lamp--yellow";
        case Status.BOLOVANJE: return "lamp--blue";
        default: return "";
    }
}
// Odabir izvora za carousel: online radnici (assignment) + standby
function getCarouselList() {
    // online radnici po trenutnom assignmentu (redoslijed pozicija)
    const onlineIds = rotationOrder.map(pos => assignment[pos]);
    const uniqOnline = [...new Set(onlineIds)]
        .map(id => ({ ime: workersMap[id]?.ime || id, uloga: "Linija", status: workersMap[id]?.status || Status.POSAO }));

    // standby
    const standby = standbyWorkers.map(s => ({ ime: s.ime, uloga: s.uloga, status: s.status }));

    return [...uniqOnline, ...standby];
}

function renderWorkerCard(item) {
    const nameEl = document.getElementById("wcardName");
    const roleEl = document.getElementById("wcardRole");
    const avatarEl = document.getElementById("wcardAvatar");
    const lampEl = document.getElementById("wcardLamp");
    const statusEl = document.getElementById("wcardStatus");
    if (!nameEl || !roleEl || !avatarEl || !lampEl || !statusEl) return;

    nameEl.textContent = item.ime;
    roleEl.textContent = item.uloga;
    avatarEl.textContent = getInitials(item.ime);
    statusEl.textContent = item.status;

    // reset lamp klasa pa dodaj novu
    lampEl.className = "lamp";
    lampEl.classList.add(statusToLampClass(item.status));
}

let cardIndex = 0;
function startWorkerCardCarousel() {
    const list = getCarouselList();
    if (list.length === 0) return;
    renderWorkerCard(list[cardIndex % list.length]);
    setInterval(() => {
        const freshList = getCarouselList(); // uzmi svježi (ako se assignment promijeni)
        cardIndex = (cardIndex + 1) % freshList.length;
        renderWorkerCard(freshList[cardIndex]);
    }, 5000); // 5 sekundi
}



// ------------------------ Inicijalizacija UI ------------------------
updateUI();
updatePositionCounts();
updatePanel();
renderStandby();
startWorkerCardCarousel();


// ------------------------ UI helperi ------------------------
function displayName(workerId) {
    const w = workersMap[workerId];
    return w ? w.ime : "";
}

function updateUI() {
    for (const pos of rotationOrder) {
        const workerId = assignment[pos];
        const el = document.getElementById(pos);
        if (el) el.innerText = displayName(workerId);
    }
}

function updatePanel() {
    const dayEl = document.getElementById("dayLabel");
    const shiftEl = document.getElementById("shiftLabel");
    const roundEl = document.getElementById("roundLabel");
    if (dayEl) dayEl.textContent = days[dayIndex];
    if (shiftEl) shiftEl.textContent = shiftLetter;      // A ili B
    if (roundEl) roundEl.textContent = `${roundInShift} / ${SHIFT_ROUNDS}`;
}

function updatePositionCounts() {
    for (const pos of rotationOrder) {
        const workerId = assignment[pos];
        positionCounts[workerId][pos]++;
    }
}

// ------------------------ Vizualni popup greške (ako si dodao CSS .error-pop) ------------------------
function showErrorPopup(pos, n = 1) {
    const container = document.querySelector(".container");
    const target = document.getElementById(pos);
    if (!container || !target) return;

    const baseLeft = target.offsetLeft + target.offsetWidth / 2;
    const baseTop = target.offsetTop - 6;

    for (let i = 0; i < n; i++) {
        setTimeout(() => {
            const pop = document.createElement("div");
            pop.className = "error-pop";
            pop.textContent = "×";
            pop.style.left = baseLeft + "px";
            pop.style.top = baseTop + "px";
            container.appendChild(pop);
            setTimeout(() => pop.remove(), 520);
        }, i * 100);
    }
}

// ------------------------ Greške: simulacija + akumulacija ------------------------
function simulateErrors() {
    const picks = shuffle([...POSITIONS_TO_CHECK]).slice(0, ERR_EVENTS_PER_ROTATION);
    for (const pos of picks) {
        if (Math.random() < ERROR_PROB) {
            const workerId = assignment[pos];
            const n = randInt(ERRORS_MIN, ERRORS_MAX);
            // ukupno
            errorCounts[workerId][pos] += n;
            errorLog.push({ ts: Date.now(), workerId, worker: displayName(workerId), pos, count: n });
            // po smjeni (KLJUČNO za izvještaj po smjenama)
            currentShiftErrors[workerId][pos] += n;

            // vizualni indikator (ako imaš CSS)
            showErrorPopup(pos, n);
        }
    }
}

// ------------------------ Rotacija i smjene ------------------------
function rotate() {
    // rotacija: 1L->...->4D->5->1L
    const lastId = assignment["5"];
    for (let i = rotationOrder.length - 1; i > 0; i--) {
        assignment[rotationOrder[i]] = assignment[rotationOrder[i - 1]];
    }
    assignment["1L"] = lastId;

    updateUI();
    updatePositionCounts();
    simulateErrors();

    roundInShift++;
    totalRotations++;

    if (roundInShift >= SHIFT_ROUNDS) {
        closeShiftAndStartNext(); // snimi smjenu A/B + promijeni dan i resetiraj rundu
    } else {
        updatePanel();
    }

    if (totalRotations >= TOTAL_ROTATIONS_BEFORE_SUMMARY) {
        clearInterval(rotationInterval);
        showSummary();
    }
}

// Zatvori tekuću smjenu i kreni u sljedeću (A↔B + idući dan)
function closeShiftAndStartNext() {
    // 1) snimi snapshot tekuće smjene
    const snapshot = JSON.parse(JSON.stringify(currentShiftErrors));
    shiftsReport.push({
        day: days[dayIndex],
        shift: shiftLetter,    // "A" ili "B"
        errors: snapshot
    });

    // 2) reset akumulatora grešaka po smjeni
    currentShiftErrors = makeEmptyMatrix();

    // 3) promijeni smjenu A<->B i dan
    shiftLetter = (shiftLetter === "A") ? "B" : "A";
    dayIndex = (dayIndex + 1) % days.length;

    // 4) reset runde i panel
    roundInShift = 0;
    updatePanel();
}

// Ručno: gumb "Nova smjena"
function nextShift() {
    closeShiftAndStartNext();
}

// Event listener za gumb (ako postoji u HTML-u)
const nextShiftBtn = document.getElementById("nextShiftBtn");
if (nextShiftBtn) nextShiftBtn.addEventListener("click", nextShift);

// ------------------------ Sažetak ------------------------
function showSummary() {
    const summaryDiv = document.createElement("div");
    summaryDiv.style.marginTop = "24px";

    // Ako smo usred smjene i ima nakupljenih grešaka, snimi i tu parcijalnu smjenu (ako koristiš shift report)
    if (typeof roundInShift !== "undefined" && roundInShift > 0 && typeof currentShiftErrors !== "undefined") {
        if (typeof shiftsReport !== "undefined") {
            const snapshot = JSON.parse(JSON.stringify(currentShiftErrors));
            shiftsReport.push({ day: days[dayIndex], shift: shiftLetter, errors: snapshot });
        }
        if (typeof makeEmptyMatrix === "function") currentShiftErrors = makeEmptyMatrix();
        roundInShift = 0;
    }

    // Helper: izračun zbroja po radniku (po redu) iz matrice [workerId][pos]
    function rowTotal(matrix, workerId) {
        return rotationOrder.reduce((acc, pos) => acc + (matrix[workerId][pos] || 0), 0);
    }

    let html = "";

    // ── 1) Pojavljivanja po pozicijama (UKUPNO) + kolona "Ukupno" ─────────────
    html += `<div class="table-card">`;
    html += `<h3 class="report-caption">Statistika pozicija (ukupno)</h3>`;
    html += `<div class="table-wrap"><table class="report-table"><thead><tr>`;
    html += `<th>Radnik</th>`;
    for (const pos of rotationOrder) html += `<th>${pos}</th>`;
    html += `<th class="th-ukupno">Ukupno</th>`;
    html += `</tr></thead><tbody>`;

    for (const w of workers) {
        const total = rowTotal(positionCounts, w.id);
        html += `<tr><td>${w.ime}</td>`;
        for (const pos of rotationOrder) {
            const v = positionCounts[w.id][pos];
            if (total > 0 && v > 0) {
                const pct = ((v / total) * 100).toFixed(1);
                html += `<td><span class="badge" title="${pct}% od ukupno">${v}</span></td>`;
            } else {
                html += `<td>0</td>`;
            }
        }
        html += `<td class="td-ukupno"><span class="badge badge--sum" title="Zbroj reda">${total}</span></td>`;
        html += `</tr>`;
    }
    html += `</tbody></table></div></div>`;

    // ── razdvojna linija ──
    html += `<div class="hr-soft"></div>`;

    // ── 2) Greške po radniku i poziciji (UKUPNO) + kolona "Ukupno" ────────────
    html += `<div class="table-card">`;
    html += `<h3 class="report-caption">Greške po radniku i poziciji (ukupno)</h3>`;
    html += `<div class="table-wrap"><table class="report-table"><thead><tr>`;
    html += `<th>Radnik</th>`;
    for (const pos of rotationOrder) html += `<th>${pos}</th>`;
    html += `<th class="th-ukupno">Ukupno</th>`;
    html += `</tr></thead><tbody>`;

    for (const w of workers) {
        const totalErr = rowTotal(errorCounts, w.id);
        html += `<tr><td>${w.ime}</td>`;
        for (const pos of rotationOrder) {
            const v = errorCounts[w.id][pos];
            if (totalErr > 0 && v > 0) {
                const pct = ((v / totalErr) * 100).toFixed(1);
                html += `<td><span class="badge" title="${pct}% od ukupnih grešaka">${v}</span></td>`;
            } else {
                html += `<td>0</td>`;
            }
        }
        html += `<td class="td-ukupno"><span class="badge badge--sum" title="Zbroj grešaka po radniku">${totalErr}</span></td>`;
        html += `</tr>`;
    }
    html += `</tbody></table></div></div>`;

    // ── 3) (Opcionalno) Greške po SMJENAMA (A/B + dan) – samo ako je uključeno ──
    if (typeof ENABLE_SHIFT_REPORT !== "undefined" && ENABLE_SHIFT_REPORT && typeof shiftsReport !== "undefined" && shiftsReport.length > 0) {
        html += `<div class="hr-soft"></div>`;
        html += `<div class="table-card">`;
        html += `<h3 class="report-caption">Greške po smjenama (A/B + dan)</h3>`;
        for (const rep of shiftsReport) {
            html += `<h4 class="report-caption" style="margin-top:8px;">${rep.day} — Smjena ${rep.shift}</h4>`;
            html += `<div class="table-wrap"><table class="report-table"><thead><tr>`;
            html += `<th>Radnik</th>`;
            for (const pos of rotationOrder) html += `<th>${pos}</th>`;
            html += `<th class="th-ukupno">Ukupno</th>`;
            html += `</tr></thead><tbody>`;
            for (const w of workers) {
                const rowSum = rowTotal(rep.errors, w.id);
                html += `<tr><td>${w.ime}</td>`;
                for (const pos of rotationOrder) {
                    const v = rep.errors[w.id][pos];
                    if (rowSum > 0 && v > 0) {
                        const pct = ((v / rowSum) * 100).toFixed(1);
                        html += `<td><span class="badge" title="${pct}% u ovoj smjeni">${v}</span></td>`;
                    } else {
                        html += `<td>0</td>`;
                    }
                }
                html += `<td class="td-ukupno"><span class="badge badge--sum" title="Zbroj u smjeni">${rowSum}</span></td>`;
                html += `</tr>`;
            }
            html += `</tbody></table></div>`;
        }
        html += `</div>`;
    }

    summaryDiv.innerHTML = html;
    document.body.appendChild(summaryDiv);
}



// ------------------------ Util ------------------------
function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

// Auto-rotacija
const rotationInterval = setInterval(rotate, 3000);
