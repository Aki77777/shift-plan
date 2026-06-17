// === globals ===
let wcardBrowseIndex = null;   // null = LIVE (nije u pregledu)

// localStorage ključevi i konstante (moraju biti na vrhu – koriste se u init bloku)
const LS_POSITIONS_KEY = "workerPositions_v1";
const LS_STATUS_KEY = "workerStatuses_v1";

// ===== Mod2 (Brzina 50%) =====
let currentMode = "mod1";
// Redoslijed ciklusa u mod2: 1D→2→3D→4D→5→1L→3L→4L→1D
const mod2CyclePositions = ["1D", "2", "3D", "4D", "5", "1L", "3L", "4L"];
const mod2ActivePositions = ["1L", "3L", "4L", "1D", "3D", "4D", "2", "5"];
const __mod2CycleIdx = Object.fromEntries(mod2CyclePositions.map((p, i) => [p, i]));
let worker590Id = null;
const STATUS_OPTIONS = [
    { value: "na_poslu",   label: "Na poslu",  cls: "status-btn--posao"     },
    { value: "bolovanje",  label: "Bolovanje", cls: "status-btn--bolovanje" },
    { value: "godisnji",   label: "Godišnji",  cls: "status-btn--godisnji"  },
    { value: "slobodan",   label: "Slobodan",  cls: "status-btn--slobodan"  },
];

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


// ——— Meisterei 4 (susjedni pogon): statusi na hrvatskom ———
const M4Status = {
    RASPOLOZIV: "raspoloživ",
    ZAUZET: "zauzet",
    ODSUTAN: "odsutan"
};

// Minimalni primjer (prilagodi imenima i kvalifikacijama)
const meisterei4Map = {
    "m4_01": { ime: "Nikola Kovač", uloga: "M4", statusM4: M4Status.RASPOLOZIV, sposobnePozicije: ["1L", "2L", "3L", "4L"] },
    "m4_02": { ime: "Ivana Radić", uloga: "M4", statusM4: M4Status.RASPOLOZIV, sposobnePozicije: ["1D", "2D"] },
    "m4_03": { ime: "Petar Marić", uloga: "M4", statusM4: M4Status.ZAUZET, sposobnePozicije: ["2L", "2D", "3D"] },
    "m4_04": { ime: "Sara Horvat", uloga: "M4", statusM4: M4Status.RASPOLOZIV, sposobnePozicije: rotationOrder }, // zna sve
    "m4_05": { ime: "Lea Perić", uloga: "M4", statusM4: M4Status.RASPOLOZIV, sposobnePozicije: ["5"] },
};

const borrowedM4 = new Set(); // ID-jevi M4 koje smo posudili u naš pool

function borrowM4ToPosition(m4id, pos) {
    const w = meisterei4Map[m4id];
    if (!w) return;

    // 1) Označi ga “zauzet” u M4
    w.statusM4 = M4Status.ZAUZET;

    // 2) Ako još nije u našem poolu, ubaci (status = na_poslu)
    if (!workersMap[m4id]) {
        workersMap[m4id] = {
            id: m4id,
            ime: w.ime,
            uloga: w.uloga,
            status: Status.POSAO,
            sposobnePozicije: w.sposobnePozicije,
            origin: "M4"
        };
        borrowedM4.add(m4id);
    } else {
        // već postoji (ranije posuđen) → samo osiguraj status “na_poslu”
        workersMap[m4id].status = Status.POSAO;
    }

    // 3) Popuni trenutno praznu poziciju
    assignment[pos] = m4id;

    // 4) Osvježi UI i tablice
    renderM4Table();
    updateUI();
    startAutoRotation();
}


function returnBorrowedM4AtShiftEnd() {
    borrowedM4.forEach(id => {
        // makni iz našeg poola (više nije “naš”)
        delete workersMap[id];
        // vrati status u M4 na “raspoloživ”
        if (meisterei4Map[id]) meisterei4Map[id].statusM4 = M4Status.RASPOLOZIV;
    });
    borrowedM4.clear();
    renderM4Table(); // osvježi prikaz M4 tablice
}




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

function renderM4Table() {
    const el = document.getElementById("m4Table");
    if (!el) return;

    const rows = Object.entries(meisterei4Map).map(([id, w]) => {
        const flag = renderInlineFlag(w); // koristi tvoju postojeću funkciju (po sposobnostima)
        const st = w.statusM4;
        return `<tr>
      <td class="name"><span class="badge-m4">M4</span> ${w.ime} ${flag}</td>
      <td>${st}</td>
    </tr>`;
    }).join("");

    el.innerHTML = `<table>
    <thead><tr><th>Radnik</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function m4CandidatesForPosition(pos) {
    // raspoloživi koji smiju na tu poziciju
    return Object.entries(meisterei4Map)
        .filter(([id, w]) => w.statusM4 === M4Status.RASPOLOZIV && w.sposobnePozicije.includes(pos))
        .map(([id, w]) => ({ id, ...w }));
}

// jednostavno bodovanje: prioritet radnicima s manje ukupnih pozicija (specijalisti)
function scoreM4(w) { return (w.sposobnePozicije?.length || 99); }

function openM4Suggest(pos) {
    stopAutoRotation();
    const list = m4CandidatesForPosition(pos).sort((a, b) => scoreM4(a) - scoreM4(b)).slice(0, 5);
    const box = document.getElementById("m4Suggest");
    const ref = document.getElementById("m4PosRef");
    const ul = document.getElementById("m4List");
    if (!box || !ref || !ul) return;

    ref.textContent = pos;
    if (!list.length) {
        ul.innerHTML = `<div class="m4-item"><div class="meta"><div class="m4-worker-info"><div class="m4-worker-name">Nema raspoloživih radnika za poziciju ${pos}.</div></div></div></div>`;
    } else {
        ul.innerHTML = list.map(w => {
            const flag = renderInlineFlag(w);
            const posCount = w.sposobnePozicije?.length === rotationOrder.length
                ? "sve pozicije"
                : `${w.sposobnePozicije?.length ?? 0} pozicija`;
            return `<div class="m4-item">
        <div class="meta">
            <div class="m4-avail-dot"></div>
            <span class="badge-m4">M4</span>
            <div class="m4-worker-info">
                <div class="m4-worker-name">${w.ime} ${flag}</div>
                <div class="m4-worker-sub">Raspoloživ · ${posCount}</div>
            </div>
        </div>
        <button class="m4-choose" data-m4id="${w.id}" data-pos="${pos}">Dodaj</button>
      </div>`;
        }).join("");
    }

    box.classList.remove("hidden");
}

function closeM4Suggest() {
    const box = document.getElementById("m4Suggest");
    if (box) box.classList.add("hidden");
    startAutoRotation();
}


function maybeSuggestM4() {
    // nađi prvu praznu poziciju
    const emptyPos = rotationOrder.find(p => !assignment[p]);
    if (!emptyPos) return; // nema rupa
    openM4Suggest(emptyPos);
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
    // 1) ID-jevi koji su trenutno na traci (po redoslijedu pozicija)
    const onlineIds = rotationOrder
        .map(pos => assignment[pos])
        .filter(Boolean); // izbaci prazna mjesta

    // 2) Mapa u PUNE objekte iz workersMap (dodamo i .id ako fali)
    const online = onlineIds
        .map(id => {
            const w = workersMap[id];
            return w ? { id, ...w } : null;
        })
        .filter(Boolean);

    // 3) “Standby” aktivni koji nisu na traci (da ima što vrtiti ako netko nije zauzeo poziciju)
    const onlineSet = new Set(onlineIds);
    const standby = Object.entries(workersMap)
        .filter(([id, w]) => w && w.status === Status.POSAO && !onlineSet.has(id))
        .map(([id, w]) => ({ id, ...w }));

    // 4) Prioritet: ONLINE ako ih ima → inače STANDBY → inače SVI (fallback)
    const all = Object.entries(workersMap).map(([id, w]) => ({ id, ...w }));
    return online.length ? online : (standby.length ? standby : all);
}


function renderWorkerCard(item) {
    const nameEl = document.getElementById("wcardName");
    const roleEl = document.getElementById("wcardRole");
    const avatarEl = document.getElementById("wcardAvatar");
    const lampEl = document.getElementById("wcardLamp");
    const statusEl = document.getElementById("wcardStatus");
    if (!nameEl || !roleEl || !avatarEl || !lampEl || !statusEl) return;

    // prije: nameEl.textContent = item.ime;
    nameEl.innerHTML = `${item.ime} ${renderInlineFlag(item)}`;
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

    //INIT prikaz
    wcardBrowseIndex = null;
    showWcard(list[cardIndex % list.length], "LIVE");

    setInterval(() => {
        const freshList = getCarouselList(); // uzmi svježi (ako se assignment promijeni)
        if (!freshList.length) return;
        cardIndex = (cardIndex + 1) % freshList.length;

        //AUTO rotacija -> uvijek LIVE
        wcardBrowseIndex = null;                    // ← izađi iz PREGLED moda
        showWcard(freshList[cardIndex], "LIVE");    // ← postavi LIVE
    }, 5000); // 5 sekundi
}



if (!window.__m4WrapApplied) {
    window.__m4WrapApplied = true;
    const __origUpdateUI = updateUI;
    updateUI = function wrappedUpdateUI() {
        __origUpdateUI.apply(this, arguments);
        if (document.querySelector('.empty')) maybeSuggestM4();
    };
}


// ------------------------ Inicijalizacija nakon što je SVE spremno ------------------------
loadSavedPositions();
loadSavedStatuses();
cleanInactiveAssignments();
cleanDisqualifiedAssignments();
updateUI();
updatePositionCounts();
updatePanel();
renderStandby();
renderM4Table();
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
    const positions = currentMode === "mod2" ? mod2ActivePositions : rotationOrder;

    // U mod2 mapiramo poziciju "2" na element s id="pos2"
    function getEl(pos) {
        if (pos === "2") return document.getElementById("pos2");
        return document.getElementById(pos);
    }

    for (const pos of positions) {
        const el = getEl(pos);
        if (!el) continue;

        const workerId = assignment[pos];
        const worker = workerId ? workersMap[workerId] : null;

        if (worker && worker.ime) {
            el.textContent = worker.ime;
            el.classList.remove('empty');
        } else {
            el.textContent = "X";
            el.classList.add('empty');
            el.classList.add("flash-x");
            setTimeout(() => el.classList.remove("flash-x"), 600);
        }

        const oldFlag = el.querySelector(".corner-flag");
        if (oldFlag) oldFlag.remove();

        if (worker) {
            const f = flagCodeFor(worker);
            if (f) {
                const span = document.createElement("span");
                span.className = `corner-flag flag-${f}`;
                span.title = (f === "red") ? "1 pozicija"
                    : (f === "orange") ? "2–3 pozicije"
                        : "4+ pozicija";
                el.appendChild(span);
            }
        }
    }

    if (currentMode === "mod2") render590Card();
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
    const positions = currentMode === "mod2" ? mod2ActivePositions : rotationOrder;
    for (const pos of positions) {
        const wid = assignment[pos];
        if (wid && !isActive(wid)) {
            assignment[pos] = undefined;
        }
    }
}

// Ukloni radnike s pozicija za koje više nisu kvalificirani (nakon učitavanja iz localStorage)
function cleanDisqualifiedAssignments() {
    for (const pos of rotationOrder) {
        const wid = assignment[pos];
        if (!wid) continue;
        const w = workersMap[wid];
        if (w && !canDo(w, pos)) {
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
    // prvo probaj u workersMap (uključuje M4 “posuđene”)
    const w = workersMap[id];
    if (w) return w.id ? w : { id, ...w };  // osiguraj da objekt ima id

    // fallback na statički niz workers (ako kojim slučajem nije u map-i)
    return workers.find(x => x.id === id) || null;
}


function isActiveWorker(worker) {
    // tvoj Status.POSAO je "na_poslu" → samo direktno usporedi
    return !!worker && worker.status === Status.POSAO;
}

function getActiveWorkersList() {
    const list = Object.values(workersMap || {});     // koristi workersMap sigurno
    const active = list.filter(w => w && w.status === Status.POSAO); // ← koristi konstante
    return active.length ? active : list;             // fallback: ako nema POSAO, koristi sve
}



function showWcard(item, modeText = "LIVE") {
    // koristiš svoju postojeću funkciju za karticu:
    renderWorkerCard(item);
    const m = document.getElementById("wcardMode");
    if (m) m.textContent = modeText;
}


function allowedCount(w) {
    const arr = Array.isArray(w?.sposobnePozicije) ? w.sposobnePozicije : [];
    return arr.length === 0 ? rotationOrder.length : arr.length; // prazno = zna sve
}

function flagCodeFor(w) {
    const n = allowedCount(w);
    if (n === rotationOrder.length) return "";   // zna sve → bez oznake
    if (n === 1) return "red";                   // 1 pozicija
    if (n === 2 || n === 3) return "orange";     // 2–3 pozicije
    return "yellow";                              // 4+ pozicija
}

function renderInlineFlag(w) {
    const f = flagCodeFor(w);
    if (!f) return "";
    const title = f === "red" ? "1 pozicija" : (f === "orange" ? "2–3 pozicije" : "4+ pozicija");
    return `<span class="inline-flag flag-${f}" title="${title}"></span>`;
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
            let label;
            if (wid) {
                const w = getWorkerById(wid);
                const name = (w?.ime || wid);
                // ime + mali trokut (crveni/narančasti/žuti) prema broju dopuštenih pozicija
                label = `${name} ${renderInlineFlag(w)}`;
            } else {
                label = '<span class="cell-x">X</span>'; // ostavi tvoju varijantu za prazno
            }
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

    assignment = currentMode === "mod2"
        ? computeNextAssignmentMod2(assignment)
        : computeNextAssignment(assignment);
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
        <div class="name">${w.ime} ${renderInlineFlag(w)}</div>
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

    returnBorrowedM4AtShiftEnd();
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


(function setupWcardNav() {
    const prev = document.getElementById("wcardPrev");
    const next = document.getElementById("wcardNext");
    if (!prev || !next) return;

    prev.addEventListener("click", () => {
        console.log("[wcard] prev click");          // <— vidiš li ovo u Console?
        const list = getActiveWorkersList();
        if (list.length === 0) return;

        if (wcardBrowseIndex === null) wcardBrowseIndex = 0;
        else wcardBrowseIndex = (wcardBrowseIndex - 1 + list.length) % list.length;

        showWcard(list[wcardBrowseIndex], "PREGLED");
    });

    next.addEventListener("click", () => {
        console.log("[wcard] next click");          // <— vidiš li ovo u Console?
        const list = getActiveWorkersList();
        if (list.length === 0) return;

        if (wcardBrowseIndex === null) wcardBrowseIndex = 0;
        else wcardBrowseIndex = (wcardBrowseIndex + 1) % list.length;

        showWcard(list[wcardBrowseIndex], "PREGLED");
    });
})();

// ===== Status radnika =====

function loadSavedStatuses() {
    const saved = localStorage.getItem(LS_STATUS_KEY);
    if (!saved) return;
    try {
        const data = JSON.parse(saved);
        for (const [id, status] of Object.entries(data)) {
            const w = workers.find(x => x.id === id);
            if (w) {
                w.status = status;
                if (workersMap[id]) workersMap[id].status = status;
            }
        }
    } catch (e) {}
}

let statusEditState = {};

function openStatusModal() {
    statusEditState = {};
    for (const w of workers) statusEditState[w.id] = workersMap[w.id]?.status ?? Status.POSAO;

    const box = document.getElementById("statusWorkerList");
    if (box) box.innerHTML = workers.map(w => `
        <div class="status-worker-row">
            <div class="status-worker-name">${w.ime}</div>
            <div class="status-btn-group" id="statusBtns_${w.id}">
                ${STATUS_OPTIONS.map(opt => `
                    <button class="status-btn ${opt.cls} ${statusEditState[w.id] === opt.value ? 'active' : ''}"
                        onclick="setWorkerStatus('${w.id}', '${opt.value}')">
                        ${opt.label}
                    </button>`).join("")}
            </div>
        </div>`).join("");

    document.getElementById("statusModal")?.classList.remove("hidden");
}

function closeStatusModal() {
    document.getElementById("statusModal")?.classList.add("hidden");
    statusEditState = {};
}

function setWorkerStatus(workerId, status) {
    statusEditState[workerId] = status;
    const group = document.getElementById(`statusBtns_${workerId}`);
    if (!group) return;
    group.querySelectorAll(".status-btn").forEach(btn => {
        btn.classList.toggle("active", btn.textContent.trim() === STATUS_OPTIONS.find(o => o.value === status)?.label);
    });
}

function saveStatusChanges() {
    for (const [id, status] of Object.entries(statusEditState)) {
        const w = workers.find(x => x.id === id);
        if (w) w.status = status;
        if (workersMap[id]) workersMap[id].status = status;
    }
    localStorage.setItem(LS_STATUS_KEY, JSON.stringify(statusEditState));
    cleanInactiveAssignments();
    updateUI();
    sanityCheckCoverage();
    closeStatusModal();
}

document.getElementById("statusModal")?.addEventListener("click", (e) => {
    if (e.target === document.getElementById("statusModal")) closeStatusModal();
});

// ===== Dodjela pozicija =====

function loadSavedPositions() {
    const saved = localStorage.getItem(LS_POSITIONS_KEY);
    if (!saved) return;
    try {
        const data = JSON.parse(saved);
        for (const [id, positions] of Object.entries(data)) {
            const w = workers.find(x => x.id === id);
            if (w) {
                w.sposobnePozicije = positions;
                if (workersMap[id]) workersMap[id].sposobnePozicije = positions;
            }
        }
    } catch (e) {}
}

let posEditState = { workerId: null, positions: [] };

function openPositionAssignment() {
    posEditState = { workerId: null, positions: [] };
    const box = document.getElementById("posWorkerList");
    if (box) {
        box.innerHTML = workers.map(w => `
            <div class="pos-worker-item" data-id="${w.id}" onclick="selectWorkerForEdit('${w.id}')">
                ${w.ime} ${renderInlineFlag(w)}
            </div>`).join("");
    }
    const editor = document.getElementById("posEditor");
    if (editor) editor.innerHTML = `<p class="pos-hint">← Odaberi radnika s liste</p>`;
    document.getElementById("positionModal")?.classList.remove("hidden");
}

function closePosModal() {
    document.getElementById("positionModal")?.classList.add("hidden");
    posEditState = { workerId: null, positions: [] };
}

function selectWorkerForEdit(workerId) {
    posEditState.workerId = workerId;
    const w = workersMap[workerId];
    posEditState.positions = Array.isArray(w?.sposobnePozicije) && w.sposobnePozicije.length > 0
        ? [...w.sposobnePozicije]
        : [...rotationOrder];

    document.querySelectorAll(".pos-worker-item").forEach(el => {
        el.classList.toggle("selected", el.dataset.id === workerId);
    });

    renderPosButtons();
}

function renderPosButtons() {
    const editor = document.getElementById("posEditor");
    if (!editor || !posEditState.workerId) return;
    const w = workersMap[posEditState.workerId];
    const displayOrder = ["1L", "1D", "2L", "2D", "3L", "3D", "4L", "4D", "5"];
    editor.innerHTML = `
        <div class="pos-editor-name">${w.ime}</div>
        <div class="pos-buttons">
            ${displayOrder.map(pos => {
                const can = posEditState.positions.includes(pos);
                const centerClass = pos === "5" ? " pos-btn--center" : "";
                return `<button class="pos-btn ${can ? 'pos-btn--green' : 'pos-btn--red'}${centerClass}"
                    onclick="togglePosButton('${pos}')">${pos}</button>`;
            }).join("")}
        </div>`;
}

function togglePosButton(pos) {
    const idx = posEditState.positions.indexOf(pos);
    if (idx >= 0) posEditState.positions.splice(idx, 1);
    else posEditState.positions.push(pos);
    renderPosButtons();
}

function savePosChanges() {
    if (!posEditState.workerId) { closePosModal(); return; }

    const w = workers.find(x => x.id === posEditState.workerId);
    if (w) w.sposobnePozicije = [...posEditState.positions];
    if (workersMap[posEditState.workerId])
        workersMap[posEditState.workerId].sposobnePozicije = [...posEditState.positions];

    const toSave = {};
    for (const worker of workers) {
        toSave[worker.id] = workersMap[worker.id]?.sposobnePozicije ?? [...rotationOrder];
    }
    localStorage.setItem(LS_POSITIONS_KEY, JSON.stringify(toSave));

    updateUI();
    sanityCheckCoverage();
    closePosModal();
}

// Zatvori modal klikom van njega
document.getElementById("positionModal")?.addEventListener("click", (e) => {
    if (e.target === document.getElementById("positionModal")) closePosModal();
});

// ===== Mod2: Brzina 50% =====

function canDoInMod2(w, pos) {
    if (pos === "2") return canDo(w, "2L") || canDo(w, "2D");
    return canDo(w, pos);
}

function computeNextAssignmentMod2(currentAssign) {
    const next = {};
    const occupied = new Set();
    const placedIds = new Set();

    // Svi aktivni radnici: na liniji + onaj na 590/591
    const inAssignment = Object.values(currentAssign).filter(Boolean);
    const allIds = [...new Set([...inAssignment, ...(worker590Id ? [worker590Id] : [])])];

    const candidates = allIds
        .map(id => getWorkerById(id))
        .filter(w => w && isActiveWorker(w))
        .map(w => {
            const can = mod2ActivePositions.filter(pos => canDoInMod2(w, pos));
            return { w, can, canCount: can.length };
        })
        .sort((a, b) => (a.canCount - b.canCount) || (a.w.id > b.w.id ? 1 : -1));

    for (const { w, can } of candidates) {
        if (placedIds.has(w.id)) continue;

        const src = Object.keys(currentAssign).find(p => currentAssign[p] === w.id)
            ?? (w.id === worker590Id ? null : null);

        // nominalna sljedeća pozicija u mod2 ciklusu
        let target = null;
        if (src && __mod2CycleIdx[src] !== undefined) {
            const nominal = mod2CyclePositions[(__mod2CycleIdx[src] + 1) % mod2CyclePositions.length];
            if (can.includes(nominal) && !next[nominal]) {
                target = nominal;
            }
        }

        if (!target) {
            const startIdx = src && __mod2CycleIdx[src] !== undefined ? __mod2CycleIdx[src] : 0;
            for (let step = 1; step <= mod2CyclePositions.length; step++) {
                const pos = mod2CyclePositions[(startIdx + step) % mod2CyclePositions.length];
                if (!occupied.has(pos) && can.includes(pos)) {
                    target = pos;
                    break;
                }
            }
        }

        if (target) {
            next[target] = w.id;
            occupied.add(target);
            placedIds.add(w.id);
        }
    }

    // Radnik koji nije raspoređen ide na 590/591
    worker590Id = allIds.find(id => {
        const w = getWorkerById(id);
        return w && isActiveWorker(w) && !placedIds.has(id);
    }) ?? null;

    for (const pos of mod2ActivePositions) {
        if (!next[pos]) next[pos] = null;
    }
    return next;
}

function buildInitialMod2Assignment() {
    const active = workers.filter(w => w.status === Status.POSAO);
    const newAssign = {};
    const occupied = new Set();
    const placed = new Set();

    const candidates = active
        .map(w => {
            const can = mod2ActivePositions.filter(pos => canDoInMod2(w, pos));
            return { w, can, canCount: can.length };
        })
        .sort((a, b) => (a.canCount - b.canCount) || (a.w.id > b.w.id ? 1 : -1));

    for (const { w, can } of candidates) {
        for (const pos of mod2CyclePositions) {
            if (!occupied.has(pos) && can.includes(pos)) {
                newAssign[pos] = w.id;
                occupied.add(pos);
                placed.add(w.id);
                break;
            }
        }
    }

    worker590Id = active.find(w => !placed.has(w.id))?.id ?? null;
    for (const pos of mod2ActivePositions) {
        if (!newAssign[pos]) newAssign[pos] = null;
    }
    return newAssign;
}

function buildInitialMod1Assignment() {
    const active = workers.filter(w => w.status === Status.POSAO);
    const newAssign = {};
    const occupied = new Set();

    const candidates = active
        .map(w => ({ w, count: allowedCount(w) }))
        .sort((a, b) => a.count - b.count);

    for (const { w } of candidates) {
        for (const pos of rotationOrder) {
            if (!occupied.has(pos) && canDo(w, pos)) {
                newAssign[pos] = w.id;
                occupied.add(pos);
                break;
            }
        }
    }
    for (const pos of rotationOrder) {
        if (!newAssign[pos]) newAssign[pos] = null;
    }
    return newAssign;
}

function render590Card() {
    const card = document.getElementById("card590");
    const nameEl = document.getElementById("name590");
    if (!card) return;
    if (worker590Id) {
        const w = getWorkerById(worker590Id);
        if (nameEl) nameEl.textContent = w?.ime ?? "—";
        card.style.display = "flex";
    } else {
        card.style.display = "none";
    }
}

function toggleSpeedMode() {
    if (currentMode === "mod1") switchToMod2();
    else switchToMod1();
}

function switchToMod2() {
    currentMode = "mod2";
    stopAutoRotation();
    assignment = buildInitialMod2Assignment();
    document.body.classList.add("mode-mod2");
    document.getElementById("speedModeBtn").textContent = "Brzina 100%";
    updateUI();
    sanityCheckCoverage();
    startAutoRotation();
}

function switchToMod1() {
    currentMode = "mod1";
    stopAutoRotation();
    worker590Id = null;
    // Očisti pos2 element
    const pos2el = document.getElementById("pos2");
    if (pos2el) { pos2el.textContent = ""; pos2el.classList.remove("empty"); }
    assignment = buildInitialMod1Assignment();
    document.body.classList.remove("mode-mod2");
    document.getElementById("speedModeBtn").textContent = "Brzina 50%";
    const card = document.getElementById("card590");
    if (card) card.style.display = "none";
    updateUI();
    sanityCheckCoverage();
    startAutoRotation();
}

// Zatvori panel
document.getElementById("m4Close")?.addEventListener("click", closeM4Suggest);
// Klik na “Dodaj”
document.getElementById("m4List")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".m4-choose");
    if (!btn) return;
    const id = btn.getAttribute("data-m4id");
    const pos = btn.getAttribute("data-pos");
    if (id && pos) borrowM4ToPosition(id, pos);
    closeM4Suggest();
});
