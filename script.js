// Ako želiš potpuno izbjeći kršenje kvalifikacija, stavi ALLOW_FALLBACK = false
let ALLOW_FALLBACK = false; // false = STRICT (bez kršenja), true = dopušten fallback
// ← stavi false da NIKAD ne kršimo kvalifikacije


const ENABLE_SHIFT_REPORT = false;
// Uključi/isključi rotaciju s kvalifikacijama radnika:
// === Rotacije + smjene A/B + greške + izvještaj po smjenama ===
let rotationInterval = null;          // kontroliramo mi interval
const ROTATION_MS = 3000;             // koliko često rotirati



// Pozicije
const rotationOrder = ["1L", "2L", "3L", "4L", "1D", "2D", "3D", "4D", "5"];

// Kruženje po pozicijama (wrap-around) i pronalazak prve slobodne dopuštene
const __posIndex = Object.fromEntries(rotationOrder.map((p, i) => [p, i]));

function nextInCycle(pos) {
    const i = __posIndex[pos];
    return rotationOrder[(i + 1) % rotationOrder.length];
}

function findNextAllowedFreePosition(startPos, allowedPositions, occupiedSet) {
    const startIdx = __posIndex[startPos];
    for (let step = 1; step <= rotationOrder.length; step++) {
        const pos = rotationOrder[(startIdx + step) % rotationOrder.length];
        if (!occupiedSet.has(pos) && allowedPositions.includes(pos)) return pos;
    }
    return null; // nema slobodne dopuštene
}


// Status radnika (za budućnost)
const Status = { POSAO: "na_poslu", BOLOVANJE: "bolovanje", GODISNJI: "godisnji", SLOBODNO: "slobodan" };

// Radnici (objekti)
// npr. Marko ne radi 3L i 4L; Nermin ne radi 1D; Aida samo "5" (već tako stoji) - nije, treba promjeniti
const workers = [
    { id: "w1", ime: "Ivana", status: Status.POSAO, sposobnePozicije: ["1L", "2L", "3L", "4L", "1D", "2D", "3D", "4D", "5"] },
    { id: "w2", ime: "Marko", status: Status.POSAO, sposobnePozicije: ["1L", "2L"] },
    { id: "w3", ime: "Amar", status: Status.POSAO, sposobnePozicije: ["1L", "2L", "3L", "4L", "1D", "2D", "3D", "4D", "5"] },
    { id: "w4", ime: "Jasna", status: Status.POSAO, sposobnePozicije: ["1L", "2L", "3L", "4L", "1D", "2D", "3D", "4D", "5"] },
    { id: "w5", ime: "Lejla", status: Status.POSAO, sposobnePozicije: ["1L", "2L", "3L", "4L", "1D", "2D", "3D", "4D", "5"] },
    { id: "w6", ime: "Petar", status: Status.POSAO, sposobnePozicije: ["1L", "2L", "3L", "4L", "1D", "2D", "3D", "4D", "5"] },
    { id: "w7", ime: "Sara", status: Status.POSAO, sposobnePozicije: ["1L", "2L", "3L", "4L", "1D", "2D", "3D", "4D", "5"] },
    { id: "w8", ime: "Nermin", status: Status.POSAO, sposobnePozicije: ["1L", "2L", "3L", "4L", "1D", "2D", "3D", "4D", "5"] },
    { id: "w9", ime: "Aida", status: Status.POSAO, sposobnePozicije: ["5"] }
];

// Provjera pokrivenosti: Lijeva (4), Desna (4), Sredina (5 -> 1)
// Ako nema dovoljno ljudi sposobnih za neku grupu pozicija, dobit ćeš jasnu poruku u konzoli.
function sanityCheckCoverage() {
    const ACTIVE = workers.filter(w => w.status === Status.POSAO);
    const groups = [
        { name: "Lijeva", positions: ["1L", "2L", "3L", "4L"] },
        { name: "Desna", positions: ["1D", "2D", "3D", "4D"] },
        { name: "Sredina", positions: ["5"] }
    ];

    const msgs = [];

    for (const g of groups) {
        const needed = g.positions.length;
        const capable = ACTIVE.filter(w => {
            const sp = w.sposobnePozicije;
            if (!sp || sp.length === 0) return true;
            return sp.some(p => g.positions.includes(p));
        }).length;

        if (capable < needed) {
            msgs.push(`${g.name}: aktivnih sposobnih = ${capable}, potrebnih = ${needed}`);
        }
    }

    const bar = document.getElementById('coverageWarning');
    if (!bar) return;

    if (msgs.length) {
        bar.textContent = "Upozorenje pokrivenosti – " + msgs.join(" | ");
        bar.style.display = "block";
    } else {
        bar.style.display = "none";
    }
}


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

/* ===== Rasporedi po rundama (stvarna rotacija) ===== */
let currentShiftSchedule = []; // snapshotovi assignmenta po rundama u TEKUĆOJ smjeni
let completedShiftSchedules = []; // [{ day, shift, rounds: [ {pos->workerId|null}, ... ] }]

function snapshotAssignment(assign) {
    // plitki klon (vrijednosti su string|null)
    return Object.fromEntries(Object.entries(assign).map(([k, v]) => [k, v ?? null]));
}


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
    { id: "s1", ime: "Dario", uloga: "Voditelj smjene", status: Status.POSAO },
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



// ------------------------ Inicijalizacija nakon što je SVE spremno ------------------------
cleanInactiveAssignments();
updateUI();
updatePositionCounts();
updatePanel();
renderStandby();
startWorkerCardCarousel();
sanityCheckCoverage();

// Auto-rotacija
function startAutoRotation() {
    if (rotationInterval) return;
    rotationInterval = setInterval(rotate, ROTATION_MS);
}
function stopAutoRotation() {
    if (!rotationInterval) return;
    clearInterval(rotationInterval);
    rotationInterval = null;
}

// Pokreni odmah (ili koristi gumbe)
startAutoRotation();

// Gumbi start/stop
document.getElementById('startAutoBtn')?.addEventListener('click', startAutoRotation);
document.getElementById('stopAutoBtn')?.addEventListener('click', stopAutoRotation);

// Strict mod preklopnik
const strictCheckbox = document.getElementById('strictMode');
if (strictCheckbox) {
    // checked = STRICT (bez fallbacka)
    strictCheckbox.checked = (ALLOW_FALLBACK === false);
    strictCheckbox.addEventListener('change', () => {
        ALLOW_FALLBACK = !strictCheckbox.checked;
        rotate();                 // odmah “presloži” po novoj politici
        sanityCheckCoverage();    // i osvježi traku upozorenja
    });
}



// ------------------------ UI helperi ------------------------
function displayName(workerId) {
    const w = workersMap[workerId];
    return w ? w.ime : "";
}

function updateUI() {
    cleanInactiveAssignments();
    for (const pos of rotationOrder) {
        const el = document.getElementById(pos);
        if (!el) continue;

        const workerId = assignment[pos];           // npr. "w3"
        const worker = workerId ? workersMap[workerId] : null;

        if (worker && worker.ime) {
            // POPUNJENA POZICIJA
            el.textContent = worker.ime;             // prikaži ime radnika
            el.classList.remove('empty');            // makni oznaku praznog
            // NE diramo el.style.backgroundColor — boja ostaje po tvojoj CSS klasi (.L, .D, .center)
        } else {
            // PRAZNA POZICIJA (strict mod ili nema dovoljno aktivnih)
            el.textContent = "X";
            el.classList.add('empty');               // dashed outline iz CSS-a

            // kratki bljesak (ako si dodao .flash-x u CSS-u)
            el.classList.add("flash-x");
            setTimeout(() => el.classList.remove("flash-x"), 600);
        }
    }
}




function updatePanel() {
    const dayEl = document.getElementById("dayLabel");
    const shiftEl = document.getElementById("shiftLabel");
    const roundEl = document.getElementById("roundLabel");
    if (dayEl) dayEl.textContent = days[dayIndex];
    if (shiftEl) shiftEl.textContent = shiftLetter;      // A ili B
    if (roundEl) roundEl.textContent = `${roundInShift + 1} / ${SHIFT_ROUNDS}`;
}

function updatePositionCounts() {
    for (const pos of rotationOrder) {
        const workerId = assignment[pos];
        if (!workerId) continue;                 // prazna pozicija (strict) – preskoči
        if (!positionCounts[workerId]) continue; // sigurnosna provjera
        positionCounts[workerId][pos] += 1;
    }
}


function isActive(workerId) {
    const w = workersMap[workerId];
    return w && w.status === Status.POSAO;
}

// Ukloni neaktivne radnike iz trenutno dodijeljenih pozicija (odmah)
function cleanInactiveAssignments() {
    for (const pos of rotationOrder) {
        const wid = assignment[pos];
        if (wid && !isActive(wid)) {
            assignment[pos] = undefined;
        }
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
            if (!workerId) continue;                // ⟵ DODANO: preskoči praznu poziciju (X)

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

// Priprema podataka za mini graf: [{label, value}]
function computeErrorTotalsArray() {
    // pretpostavka: errorCounts[workerId][pos] = broj
    const arr = [];
    for (const w of workers) {
        let sum = 0;
        const wc = errorCounts[w.id] || {};
        for (const pos of rotationOrder) sum += (wc[pos] || 0);
        arr.push({ workerId: w.id, label: w.ime, value: sum });
    }
    return arr;
}

// Render okomitog mini grafa unutar mountEl (HTMLElement)
function renderMiniChartVertical(data, mountEl) {
    if (!mountEl) return;
    const max = Math.max(1, ...data.map(d => d.value));
    const html = `
      <div class="mini-chart v">
        ${data.map(d => {
        const h = Math.round((d.value / max) * 120); // 120px max stupac
        return `
            <div class="bar" style="height:${h}px" title="${d.label}: ${d.value}">
              <span class="val">${d.value}</span>
              <span class="lbl">${d.label}</span>
            </div>`;
    }).join('')}
      </div>
    `;
    mountEl.innerHTML = html;
}

function getTopErrorWorker() {
    // vrati { worker, total }
    let best = null;
    for (const w of workers) {
        const wc = errorCounts[w.id] || {};
        let sum = 0;
        for (const pos of rotationOrder) sum += (wc[pos] || 0);
        if (!best || sum > best.total) best = { worker: w, total: sum };
    }
    return best || { worker: null, total: 0 };
}

// --- Helperi za planiranje (ne diraju "živi" state) ---

function getWorkerById(id) {
    return workers.find(w => w.id === id);
}

function isActiveWorker(worker) {
    // tvoj Status.POSAO je "na_poslu" → samo direktno usporedi
    return !!worker && worker.status === Status.POSAO;
}

function canDo(worker, position) {
    // koristi tvoje realno polje 'sposobnePozicije'
    if (!worker) return false;
    const sp = worker.sposobnePozicije;
    // ako nije definirano ili prazno → tretiraj kao “može sve”
    if (!Array.isArray(sp) || sp.length === 0) return true;
    return sp.includes(position);
}


function cloneAssignment(assign) {
    return Object.fromEntries(Object.entries(assign).map(([k, v]) => [k, v]));
}

// rubne veze rotacije (iz tvoje sheme)
const ROTATION_EDGES = [
    ['1L', '2L'], ['2L', '3L'], ['3L', '4L'], ['4L', '1D'],
    ['1D', '2D'], ['2D', '3D'], ['3D', '4D'], ['4D', '5'],
    ['5', '1L']
];

/**
 * Izračunaj sljedeću dodjelu iz trenutne, poštujući kvalifikacije i ALLOW_FALLBACK.
 * Ne mijenja stvarni assignment; radi na kopijama.
 */
function computeNextAssignment(currentAssign) {
    const next = {};
    const occupied = new Set();
    const placedIds = new Set();

    // Unikatna lista aktivnih radnika trenutno na liniji
    const currentWorkerIds = [...new Set(Object.values(currentAssign).filter(Boolean))];

    // Kandidati: manje dopuštenih → veći prioritet; tie-break po ID-u za stabilnost
    const candidates = currentWorkerIds
        .map(id => getWorkerById(id))
        .filter(w => w && isActiveWorker(w))
        .map(w => {
            const can = (Array.isArray(w.sposobnePozicije) && w.sposobnePozicije.length > 0)
                ? w.sposobnePozicije.slice()
                : rotationOrder.slice(); // prazno = može sve
            return { w, can, canCount: can.length };
        })
        .sort((a, b) => (a.canCount - b.canCount) || (a.w.id > b.w.id ? 1 : -1));

    // Za svakog kandidata: nominalna sljedeća → ako ne može, skip-forward do prve slobodne DOPUŠTENE
    for (const { w, can } of candidates) {
        if (placedIds.has(w.id)) continue;

        const src = Object.keys(currentAssign).find(p => currentAssign[p] === w.id);
        const nominal = src ? nextInCycle(src) : null;

        let target = null;

        if (nominal && can.includes(nominal) && !next[nominal]) {
            // nominalna je dopuštena i slobodna
            target = nominal;
        } else if (src) {
            // pronađi prvu slobodnu dopuštenu poziciju naprijed (wrap-around)
            target = findNextAllowedFreePosition(src, can, occupied);
        }

        if (target) {
            next[target] = w.id;
            occupied.add(target);
            placedIds.add(w.id);
        }
    }

    // Nepopunjeno ostaje prazno (UI će prikazati X po tvojoj logici)
    for (const pos of rotationOrder) {
        if (!next[pos]) next[pos] = null;
    }

    return next;
}




function replayFrom(startAssign, rounds = 5) {
    let curr = { ...startAssign };
    const out = [];
    for (let i = 0; i < rounds; i++) {
        const next = computeNextAssignment(curr);
        out.push({
            ...next,
            __fallbackTargets: next.__fallbackTargets ? [...next.__fallbackTargets] : []
        });
        curr = next;
    }
    return { rounds: out, final: curr };
}




function renderShiftPlanTables() {
    const wrap = document.createElement('div');
    wrap.className = 'schedule-wrap';

    // A smjena: 5 rundi unaprijed od ŽIVOG assignmenta
    const simA = replayFrom(assignment, 5);

    // B smjena: 5 rundi od završnog stanja A smjene
    const simB = replayFrom(simA.final, 5);

    const cardA = document.createElement('div');
    cardA.className = 'schedule-card';
    cardA.innerHTML = `<h3>Plan smjene A — 5 rundi</h3>${buildPlanTableHTML(simA.rounds)}`;

    const cardB = document.createElement('div');
    cardB.className = 'schedule-card';
    cardB.innerHTML = `<h3>Plan smjene B — 5 rundi</h3>${buildPlanTableHTML(simB.rounds)}`;

    wrap.appendChild(cardA);
    wrap.appendChild(cardB);

    document.body.appendChild(wrap);
}


function buildPlanTableHTML(roundsArray) {
    // roundsArray: niz assignment mapa (pos -> workerId | null)
    // [2L,3L,4L,1D,2D,3D,4D,5,1L] po redu "ulaza"
    // ali za prikaz želimo klasični redoslijed:
    const displayOrder = ["1L", "2L", "3L", "4L", "1D", "2D", "3D", "4D", "5"];

    let html = `<table class="schedule-table"><thead><tr><th class="pos-col">Runda</th>`;
    for (const pos of displayOrder) html += `<th class="pos-col">${pos}</th>`;
    html += `</tr></thead><tbody>`;

    for (let i = 0; i < roundsArray.length; i++) {
        const ass = roundsArray[i];
        html += `<tr><td><strong>${i + 1}</strong></td>`;
        for (const pos of displayOrder) {
            const wid = ass[pos];
            const label = wid ? (getWorkerById(wid)?.ime || wid) : '<span class="cell-x">X</span>';
            html += `<td>${label}</td>`;
        }
        html += `</tr>`;
    }
    html += `</tbody></table>`;
    return html;
}


function buildCompletedSchedulesHTML() {
    if (!Array.isArray(completedShiftSchedules) || completedShiftSchedules.length === 0) return "";
    let html = "";
    for (const rep of completedShiftSchedules) {
        html += `<div class="table-card">`;
        html += `<h3 class="report-caption">${rep.day} — Smjena ${rep.shift} (stvarni raspored po rundama)</h3>`;
        html += buildPlanTableHTML(rep.rounds);
        html += `</div>`;
    }
    return html;
}



// Inicijali iz imena (fallback avatar)
function initialsFromName(fullName) {
    if (!fullName) return "?";
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}


// (opcionalno) Top pozicije s najviše grešaka za tog radnika
function topErrorPositionsFor(workerId, topN = 2) {
    const wc = errorCounts[workerId] || {};
    const arr = rotationOrder.map(pos => ({ pos, val: wc[pos] || 0 }));
    arr.sort((a, b) => b.val - a.val);
    return arr.filter(x => x.val > 0).slice(0, topN);
}


// Priprema polja {label, value} za graf iz distinctPerWorker
function preparePositionsChartData(distinctPerWorker) {
    return distinctPerWorker.map(d => ({ label: d.name, value: d.value }));
}


// Vodoravni prikaz (trake)
function renderPositionsChartHorizontal(data, mountEl) {
    if (!mountEl) return;
    const max = Math.max(1, ...data.map(d => d.value));
    mountEl.innerHTML = `
      <div class="chart h">
        ${data.map(d => {
        const w = Math.round((d.value / max) * 100);
        return `
            <div class="row" title="${d.label}: ${d.value}">
              <div class="name">${d.label}</div>
              <div class="track"><div class="fill" style="width:${w}%"></div></div>
              <div class="val">${d.value}</div>
            </div>`;
    }).join('')}
      </div>`;
}



// ========== OKOMITI GRAF (BROJ POZICIJA) ==========
function renderPositionsChartVertical(data, mountEl) {
    if (!mountEl) return;
    const max = Math.max(1, ...data.map(d => d.value));
    const html = `
      <div class="chart v">
        ${data.map(d => {
        const h = Math.round((d.value / max) * 120); // 120px max visina
        return `
            <div class="bar" style="height:${h}px" title="${d.label}: ${d.value}">
              <span class="val">${d.value}</span>
              <span class="lbl">${d.label}</span>
            </div>`;
    }).join('')}
      </div>
    `;
    mountEl.innerHTML = html;
}





// ------------------------ Rotacija i smjene ------------------------
function rotate() {

    // 1) makni neaktivne iz trenutnih pozicija prije svake nove dodjele
    cleanInactiveAssignments();

    assignment = computeNextAssignment(assignment);
    // zapiši snapshot ove runde u raspored tekuće smjene
    currentShiftSchedule.push(snapshotAssignment(assignment));



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

    //traka upozorenja da se dinamički osvježava nakon svake rotacije
    sanityCheckCoverage();
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

    // snimi dovršeni RASPORED po rundama za ovu smjenu
    if (currentShiftSchedule && currentShiftSchedule.length > 0) {
        completedShiftSchedules.push({
            day: days[dayIndex],
            shift: shiftLetter,
            rounds: currentShiftSchedule.map(r => ({ ...r }))
        });
    }


    // 2) reset akumulatora grešaka po smjeni
    currentShiftErrors = makeEmptyMatrix();
    // reset rasporeda rundi za novu smjenu
    currentShiftSchedule = [];


    // 3) promijeni smjenu A<->B i dan
    shiftLetter = (shiftLetter === "A") ? "B" : "A";
    dayIndex = (dayIndex + 1) % days.length;

    // 4) reset runde i panel
    roundInShift = 0;
    updatePanel();
    showSummary();
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
    // Helper: broj razlicitih pozicija koje je radio radnik (za mini graf)
    function distinctPositions(matrix, workerId) {
        return rotationOrder.reduce((acc, pos) => acc + ((matrix[workerId][pos] || 0) > 0 ? 1 : 0), 0);
    }

    let html = "";

    // ── 1) Pojavljivanja po pozicijama (UKUPNO) + "Ukupno" + mini graf ─────────────
    html += `<div class="table-card">`;
    html += `<h3 class="report-caption">Statistika pozicija (ukupno)</h3>`;
    html += `<div class="table-wrap"><table id="positionsTable" class="report-table"><thead><tr>`;
    html += `<th>Radnik</th>`;
    for (const pos of rotationOrder) html += `<th>${pos}</th>`;
    html += `<th class="th-ukupno">Ukupno</th>`;
    html += `</tr></thead><tbody>`;

    const distinctPerWorker = []; // za mini graf
    for (const w of workers) {
        const total = rowTotal(positionCounts, w.id);
        const distinct = distinctPositions(positionCounts, w.id);
        distinctPerWorker.push({ name: w.ime, value: distinct });

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
    html += `</tbody></table></div>`;

    // — Mini graf: broj RAZLIČITIH pozicija po radniku (s toggle prikaza) —
    html += `<div style="margin-top:14px;text-align:left;">
<div class="report-caption" style="margin-bottom:6px;">Mini graf: broj različitih pozicija po radniku</div>
<div class="chart-toggle">
  <button class="small soft" id="posChartHbtn">Vodoravno</button>
  <button class="small accent" id="posChartVbtn">Okomito</button>
</div>
<div id="positionsChartMount"></div>
</div>`;


    html += `</div>`; // /table-card

    // ── razdvojna linija ──
    html += `<div class="hr-soft"></div>`;

    // ── 2) Greške po radniku i poziciji (UKUPNO) + "Ukupno" + sort kontrole ────────────
    html += `<div class="table-card">`;
    html += `<div class="sort-controls">
               <button class="sort-btn" id="sortErrorsDesc">Sortiraj po greškama ↓</button>
               <button class="sort-btn" id="sortErrorsAsc">Sortiraj po greškama ↑</button>
             </div>`;
    html += `<h3 class="report-caption">Greške po radniku i poziciji (ukupno)</h3>`;
    html += `<div class="table-wrap"><table id="errorsTable" class="report-table"><thead><tr>`;
    html += `<th>Radnik</th>`;
    for (const pos of rotationOrder) html += `<th>${pos}</th>`;
    html += `<th class="th-ukupno sortable" title="Klikni za sortiranje">Ukupno</th>`;
    html += `</tr></thead><tbody>`;

    for (const w of workers) {
        const totalErr = rowTotal(errorCounts, w.id);
        html += `<tr data-total="${totalErr}"><td>${w.ime}</td>`;
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

    // ── 3) (Opcionalno) Greške po SMJENAMA (A/B + dan) – poštuje flag ENABLE_SHIFT_REPORT ──
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
                const rowSum = rotationOrder.reduce((a, p) => a + (rep.errors[w.id][p] || 0), 0);
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

    // Rasporedi po rundama — dovršene smjene (A/B)
    const schedulesHTML = buildCompletedSchedulesHTML();
    if (schedulesHTML) {
        html += `<div class="hr-soft"></div>` + schedulesHTML;
    }

    summaryDiv.innerHTML = html;

    document.body.appendChild(summaryDiv);

    // Plan smjena (A i B) – 5 rundi svaka, simulacija na klonu stanja
    // renderShiftPlanTables(); // zamijenjeno stvarnim rasporedima





    // Nacrtaj početno (okomito) i veži toggle gumbe
    const pcm = document.getElementById('positionsChartMount');
    const posData = preparePositionsChartData(distinctPerWorker);
    const btnH = document.getElementById('posChartHbtn');
    const btnV = document.getElementById('posChartVbtn');

    // default: OKOMITO
    renderPositionsChartVertical(posData, pcm);

    // toggle handleri — OVO MORA POSTOJATI TOČNO JEDNOM I BITI ZATVORENO
    btnH?.addEventListener('click', () => {
        renderPositionsChartHorizontal(posData, pcm);
        btnH.classList.add('accent'); btnH.classList.remove('soft');
        btnV.classList.add('soft'); btnV.classList.remove('accent');
    });

    btnV?.addEventListener('click', () => {
        renderPositionsChartVertical(posData, pcm);
        btnV.classList.add('accent'); btnV.classList.remove('soft');
        btnH.classList.add('soft'); btnH.classList.remove('accent');
    });



    // --- nakon tablice, izdvoji top greškaša i prikaži poruku + karticu ---
    const top = getTopErrorWorker();
    const summaryHost = document.createElement('div');
    summaryHost.style.maxWidth = '1000px';
    summaryHost.style.margin = '18px auto';
    summaryHost.style.display = 'grid';
    summaryHost.style.gridTemplateColumns = '1fr 320px';
    summaryHost.style.gap = '16px';

    // lijevo: mini graf (okomito)
    const chartBox = document.createElement('div');
    const chartTitle = document.createElement('h4');
    chartTitle.textContent = 'Greške po radniku (mini graf — okomiti prikaz)';
    chartTitle.style.margin = '8px 0 6px';
    chartBox.appendChild(chartTitle);
    const chartMount = document.createElement('div');
    chartBox.appendChild(chartMount);

    // desno: izdvojeni radnik (kartica)
    const cardBox = document.createElement('div');
    cardBox.className = 'worker-card';

    if (top.worker) {
        const w = top.worker;
        const initials = initialsFromName(w.ime);
        const statusCls = statusToLampClass(w.status);
        const topPos = topErrorPositionsFor(w.id, 2); // npr. top 2 pozicije
        const p1 = topPos[0];
        const p2 = topPos[1];


        cardBox.innerHTML = `
    <div class="card-header">
      <div class="avatar">
        ${w.avatarUrl ? `<img src="${w.avatarUrl}" alt="${w.ime}">`
                : `<div class="avatar--initials">${initials}</div>`}
      </div>
      <div class="who">
        <div class="name">${w.ime}</div>
        <div class="status"><span class="status-dot ${statusCls}"></span>
          ${w.status || 'Status nepoznat'}
        </div>
      </div>
      <div class="total" title="Ukupno grešaka">
        <span>Greške</span> <strong>${top.total}</strong>
      </div>
    </div>

    <hr class="divider">

    <div class="badges" title="Preporuke">
  <span class="badge-pill">
    🔧 Dodatna obuka
    ${p1 ? `(<span class="pos-tooltip" title="${p1.pos}: ${p1.val} grešaka">${p1.pos}</span>)` : ''}
  </span>
  <span class="badge-pill">
    🚫 Preskači problematičnu poziciju
    ${p1 ? `(<span class="pos-tooltip" title="${p1.pos}: ${p1.val} grešaka">${p1.pos}</span>)` : ''}
  </span>
  <span class="badge-pill">
    🔁 Premještaj na manje rizične
    ${p2 ? `(<span class="pos-tooltip" title="${p2.pos}: ${p2.val} grešaka">${p2.pos}</span>)` : ''}
  </span>
</div>

  `;
    } else {
        cardBox.innerHTML = `
    <div class="card-header">
      <div class="avatar"><div class="avatar--initials">NA</div></div>
      <div class="who">
        <div class="name">Nema podataka</div>
        <div class="status"><span class="status-dot status--SLOBODAN"></span> — </div>
      </div>
      <div class="total"><span>Greške</span> <strong>0</strong></div>
    </div>
    <hr class="divider">
    <div class="badges"><span class="badge-pill">Sve čisto ✔</span></div>
  `;
    }


    // ubaci u host
    summaryHost.appendChild(chartBox);
    summaryHost.appendChild(cardBox);

    // umetni summaryHost odmah iza već postojeće tablice/sažetka
    document.body.appendChild(summaryHost);

    // nacrtaj okomiti mini graf
    const data = computeErrorTotalsArray();
    renderMiniChartVertical(data, chartMount);


    // ====== JS: sortiranje errorsTable po data-total (Ukupno) ======
    function sortErrors(desc = true) {
        const table = document.getElementById('errorsTable');
        if (!table) return;
        const tbody = table.querySelector('tbody');
        const rows = Array.from(tbody.querySelectorAll('tr'));
        rows.sort((a, b) => {
            const ta = parseInt(a.getAttribute('data-total') || '0', 10);
            const tb = parseInt(b.getAttribute('data-total') || '0', 10);
            return desc ? (tb - ta) : (ta - tb);
        });
        // re-append
        rows.forEach(r => tbody.appendChild(r));
    }
    // gumbi
    const btnDesc = document.getElementById('sortErrorsDesc');
    const btnAsc = document.getElementById('sortErrorsAsc');
    btnDesc && btnDesc.addEventListener('click', () => sortErrors(true));
    btnAsc && btnAsc.addEventListener('click', () => sortErrors(false));
    // klik na header "Ukupno"
    const errorsHeadUkupno = document.querySelector('#errorsTable thead th.th-ukupno');
    let toggleDesc = true;
    errorsHeadUkupno && errorsHeadUkupno.addEventListener('click', () => {
        sortErrors(toggleDesc);
        toggleDesc = !toggleDesc;
    });
}




// ------------------------ Util ------------------------
function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }



function bindStrictToggle() {
    const el = document.getElementById('strictMode');
    if (!(el instanceof HTMLInputElement)) {
        console.warn('Strict toggle (id="strictMode") nije pronađen u DOM-u.');
        return;
    }
    // checked = STRICT (bez fallbacka)
    el.checked = (ALLOW_FALLBACK === false);

    el.addEventListener('change', () => {
        ALLOW_FALLBACK = !el.checked;  // checked => STRICT => ALLOW_FALLBACK=false
        rotate();                      // odmah presloži assignment po novoj politici
        sanityCheckCoverage && sanityCheckCoverage();
    });
}

// ako ti je <script src="script.js"> na dnu body-ja, dovoljno je:
bindStrictToggle();

// ako je skripta u <head> ili želiš dodatnu sigurnost, umjesto gornje linije koristi:
// document.addEventListener('DOMContentLoaded', bindStrictToggle);
