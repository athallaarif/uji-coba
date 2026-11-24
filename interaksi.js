document.addEventListener('DOMContentLoaded', () => {
    // 1. INISIALISASI PETA LEAFLET (Berpusat di Kota & Kab. Sorong)
    const map = L.map('map', {
        center: [-0.945, 131.325],
        zoom: 11,
        zoomControl: true
    });
    map.createPane('adminFillPane').style.zIndex = 390;
    map.createPane('districtFillPane').style.zIndex = 395;
    map.createPane('districtOutlinePane').style.zIndex = 420;
    map.createPane('parentOutlinePane').style.zIndex = 425;
    map.createPane('dailySmokePane').style.zIndex = 410;
    map.createPane('focusHaloPane').style.zIndex = 430;
    map.createPane('focusPane').style.zIndex = 440;
    map.createPane('dailyHotspotPane').style.zIndex = 450;
    map.createPane('dailyFacilityPane').style.zIndex = 455;

    // Basemaps
    const darkBasemap = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO | PjBL SIG ITB 2026',
        subdomains: 'abcd',
        maxZoom: 19
    });

    const osmBasemap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);

    const satelliteBasemap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
        maxZoom: 18
    });

    L.control.layers({
        "Dark Matter (Kontras Asap)": darkBasemap,
        "Citra Satelit (Esri)": satelliteBasemap,
        "OpenStreetMap": osmBasemap
    }, null, { position: 'topleft' }).addTo(map);

    // Skala Garis
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

    // Update Koordinat Kursor
    map.on('mousemove', (e) => {
        document.getElementById('cursor-coords').textContent = `${e.latlng.lat.toFixed(4)}°, ${e.latlng.lng.toFixed(4)}°`;
    });

    // 2. DATA SPASIAL SIMULASI REALISTIS WILAYAH KOTA & KABUPATEN SORONG
    // Data Distrik (Poligon representatif Kota Sorong & Distrik sekitar di Kab. Sorong)
    const districtsData = window.dataSkenario.districtsData;

    // Data Objek Vital & Infrastruktur (Kota & Kab. Sorong)
    const vitalFacilities = window.dataSkenario.vitalFacilities;

    // Data Titik Api Awal (Sumber Emisi di Zona Hutan/Semak Klamono, Salawati, Mariat)
    const initialHotspots = window.dataSkenario.initialHotspots;

    let hotspots = JSON.parse(JSON.stringify(initialHotspots));

    // State Simulasi
    let simState = {
        windDir: 315,    // Derajat (0 = Utara, 90 = Timur, 180 = Selatan, 270 = Barat, 315 = Barat Laut)
        windSpeed: 6.5,  // m/s
        frpMult: 1.0,    // Multiplier FRP
        plumeOpacity: 0.65
    };

    // Layer Groups Leaflet
    const layerGroups = {
        burned: L.layerGroup().addTo(map),
        aod: L.layerGroup(), // Default off, bisa dinyalakan user
        plume: L.layerGroup().addTo(map),
        wind: L.layerGroup().addTo(map),
        hotspots: L.layerGroup().addTo(map),
        facilities: L.layerGroup().addTo(map),
        adminParents: L.layerGroup(),
        adminDistricts: L.layerGroup(),
        regionFocus: L.layerGroup().addTo(map),
        dailySmoke: L.layerGroup(),
        dailyHotspots: L.layerGroup(),
        dailyFacilities: L.layerGroup()
    };

    const parentStatus = document.getElementById('admin-parent-status');
    const districtStatus = document.getElementById('district-status');
    const parentLayerCheckbox = document.getElementById('layer-admin-parents');
    const districtLayerCheckbox = document.getElementById('layer-admin-districts');
    const regionFilter = document.getElementById('region-filter');
    const appModeSelect = document.getElementById('app-mode-select');
    const dailyDateSlider = document.getElementById('daily-date-slider');
    const dailyDatePicker = document.getElementById('daily-date-picker');
    const dailyPlayButton = document.getElementById('daily-play-btn');
    const dailySmokeMethod = document.getElementById('daily-smoke-method');
    const dailySmokeToggle = document.getElementById('daily-smoke-toggle');
    const dailyHotspotsToggle = document.getElementById('daily-hotspots-toggle');
    const dailyOpacitySlider = document.getElementById('daily-opacity-slider');
    let aoiBounds = null;
    const parentFeaturesByCode = new Map();
    const parentBoundsByCode = new Map();
    const districtFeaturesByCode = new Map();
    const districtBoundsByCode = new Map();
    const districtLabelsByCode = new Map();
    const districtMinZoom = 11;
    const dailyDates = [];
    for (let day = 0; day < 25; day++) {
        dailyDates.push(new Date(Date.UTC(2026, 8, 21 + day)).toISOString().slice(0, 10));
    }
    const dailyRecords = [];
    const dailyRecordKeys = new Set();
    const importedFileHashes = new Set();
    const dailySmokeBounds = L.latLngBounds([[-2.2, 129.95], [-0.3, 132.9]]);
    const dailySmokeScale = 110;
    let dailyCurrentIndex = 0;
    let dailyTimer = null;
    let dailyChart = null;
    let dailySourceLabel = 'Data hotspot belum tersedia';
    let isDailyMode = false;
    let manualSettingsSnapshot = null;

    function setAdminStatus(element, message, isError) {
        element.textContent = message;
        element.classList.remove('hidden', 'text-amber-200', 'text-red-300', 'text-slate-500');
        element.classList.add(isError ? 'text-red-300' : 'text-amber-200');
    }

    function addAdminLabel(group, point, text, className) {
        const content = document.createElement('span');
        content.textContent = text;
        const label = L.tooltip({
            permanent: true,
            direction: 'center',
            className,
            opacity: 1
        }).setLatLng(point).setContent(content);
        group.addLayer(label);
        return label;
    }

    function validateAoiData(data) {
        const expected = {
            '96.71': { type: 5, displayName: 'Kota Sorong', sourceName: 'Kota Sorong' },
            '96.01': { type: 4, displayName: 'Kabupaten Sorong', sourceName: 'Sorong' }
        };
        if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.length !== 2) {
            throw new Error('GeoJSON AOI harus berisi tepat dua fitur wilayah.');
        }

        const foundCodes = new Set();
        data.features.forEach(feature => {
            const properties = feature.properties || {};
            const code = String(properties.KDPKAB || '').trim();
            const expectedRegion = expected[code];
            const geometry = feature.geometry;
            if (!expectedRegion ||
                properties.TIPADM !== expectedRegion.type ||
                properties.NAMOBJ !== expectedRegion.sourceName ||
                properties.display_name !== expectedRegion.displayName ||
                properties.WADMPR !== 'Papua Barat Daya' ||
                !geometry ||
                (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') ||
                !Array.isArray(geometry.coordinates) ||
                geometry.coordinates.length === 0 ||
                !Array.isArray(properties.label_point) ||
                properties.label_point.length !== 2) {
                throw new Error('GeoJSON AOI berisi wilayah atau geometri yang tidak sesuai.');
            }
            if (foundCodes.has(code)) {
                throw new Error(`Kode wilayah AOI duplikat: ${code}.`);
            }
            foundCodes.add(code);
        });
        if (foundCodes.size !== 2) {
            throw new Error('GeoJSON AOI tidak memuat Kota Sorong dan Kabupaten Sorong.');
        }
    }

    function validateDistrictData(data) {
        if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.length === 0) {
            throw new Error('GeoJSON distrik BIG tidak berisi fitur.');
        }
        const foundCodes = new Set();
        data.features.forEach(feature => {
            const properties = feature.properties || {};
            const code = String(properties.KDPKAB || '').trim();
            const districtCode = String(properties.KDCPUM || '').trim();
            const geometry = feature.geometry;
            if (properties.TIPADM !== 3 ||
                properties.WADMPR !== 'Papua Barat Daya' ||
                (code !== '96.01' && code !== '96.71') ||
                !districtCode ||
                districtCode.indexOf(`${code}.`) !== 0 ||
                !properties.WADMKC ||
                !geometry ||
                (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') ||
                !Array.isArray(geometry.coordinates) ||
                geometry.coordinates.length === 0 ||
                !Array.isArray(properties.label_point) ||
                properties.label_point.length !== 2) {
                throw new Error('GeoJSON distrik memuat atribut atau geometri yang tidak sesuai.');
            }
            if (foundCodes.has(districtCode)) {
                throw new Error(`Kode distrik BIG duplikat: ${districtCode}.`);
            }
            foundCodes.add(districtCode);
        });
    }

    function getPolygonRings(geometry) {
        if (geometry.type === 'Polygon') return [geometry.coordinates];
        return geometry.coordinates;
    }

    function addBoundaryLines(group, feature, style, popupContent) {
        getPolygonRings(feature.geometry).forEach(rings => {
            rings.forEach(ring => {
                const line = L.polyline(ring.map(coordinate => [coordinate[1], coordinate[0]]), style);
                if (popupContent) line.bindPopup(popupContent);
                group.addLayer(line);
            });
        });
    }

    function createBoundaryPopup(name, parentName, code, label) {
        const content = document.createElement('div');
        content.className = 'text-xs';
        const title = document.createElement('div');
        title.className = 'font-bold text-amber-300';
        title.textContent = name;
        const description = document.createElement('div');
        description.className = 'mt-1 text-slate-300';
        description.textContent = label;
        const parent = document.createElement('div');
        parent.className = 'mt-1 text-slate-400';
        parent.textContent = `${parentName} · Kode PUM ${code}`;
        content.append(title, description, parent);
        return content;
    }

    function parentStyle(code) {
        const isCity = code === '96.71';
        return {
            color: isCity ? '#75638f' : '#87966e',
            weight: 0,
            fillColor: isCity ? '#c4b5fd' : '#a3b18a',
            fillOpacity: 0.18
        };
    }

    function districtStyle(code, index) {
        const cityColors = ['#d9cff1', '#c4b5dc', '#e3dcf1', '#b8a7d7'];
        const countyColors = ['#d5dfc2', '#c1d0a6', '#e1e8d4', '#b0c28f', '#cbd8b8'];
        const colors = code === '96.71' ? cityColors : countyColors;
        return {
            color: code === '96.71' ? '#75638f' : '#74835b',
            weight: 0,
            fillColor: colors[index % colors.length],
            fillOpacity: 0.12
        };
    }

    function updateDistrictLayerVisibility() {
        const selectedDistrictCode = regionFilter.value.indexOf('district:') === 0
            ? regionFilter.value.slice('district:'.length)
            : null;
        const shouldShow = districtLayerCheckbox.checked &&
            districtFeaturesByCode.size > 0 &&
            (map.getZoom() >= districtMinZoom || districtFeaturesByCode.has(selectedDistrictCode));
        if (shouldShow && !map.hasLayer(layerGroups.adminDistricts)) {
            layerGroups.adminDistricts.addTo(map);
        } else if (!shouldShow && map.hasLayer(layerGroups.adminDistricts)) {
            map.removeLayer(layerGroups.adminDistricts);
        }
    }

    function loadParentBoundaries() {
    return fetch('data/aoi-sorong.geojson')
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        })
        .then(data => {
            validateAoiData(data);
            data.features.forEach(feature => {
                const properties = feature.properties;
                const code = String(properties.KDPKAB);
                const name = properties.display_name;
                const boundsLayer = L.geoJSON(feature);
                parentFeaturesByCode.set(code, feature);
                parentBoundsByCode.set(code, boundsLayer.getBounds());
                const fill = L.geoJSON(feature, {
                    pane: 'adminFillPane',
                    interactive: false,
                    style: parentStyle(code)
                });
                layerGroups.adminParents.addLayer(fill);
                addBoundaryLines(layerGroups.adminParents, feature, {
                    pane: 'parentOutlinePane',
                    color: code === '96.71' ? '#75638f' : '#74835b',
                    weight: 3.2,
                    opacity: 1
                }, createBoundaryPopup(name, 'Wilayah kajian dampak', code, 'Batas administrasi BIG'));
                addAdminLabel(layerGroups.adminParents, properties.label_point, name.toUpperCase(), 'admin-parent-label');
            });
            aoiBounds = L.geoJSON(data).getBounds();
            if (parentLayerCheckbox.checked) layerGroups.adminParents.addTo(map);
            setAdminStatus(parentStatus, 'Batas BIG aktif · edisi Juni 2026', false);
            map.fitBounds(aoiBounds, { padding: [36, 36], maxZoom: 11 });
        })
        .catch(error => {
            console.error('Gagal memuat batas kota/kabupaten BIG:', error);
            setAdminStatus(parentStatus, 'Batas administrasi belum tersedia.', true);
            parentLayerCheckbox.disabled = true;
            document.getElementById('focus-aoi-btn').disabled = true;
        });
    }

    function loadDistrictBoundaries() {
        return fetch('data/distrik-sorong.geojson')
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            })
            .then(data => {
                validateDistrictData(data);
                const counts = { '96.01': 0, '96.71': 0 };
                data.features.sort((first, second) =>
                    String(first.properties.KDPKAB).localeCompare(String(second.properties.KDPKAB)) ||
                    first.properties.WADMKC.localeCompare(second.properties.WADMKC)
                ).forEach((feature, index) => {
                    const properties = feature.properties;
                    const code = String(properties.KDCPUM);
                    const parentCode = String(properties.KDPKAB);
                    const parentName = parentCode === '96.71' ? 'Kota Sorong' : 'Kabupaten Sorong';
                    const name = `Distrik ${properties.WADMKC}`;
                    const fullLabel = `${name} · ${parentName}`;
                    const boundsLayer = L.geoJSON(feature);
                    counts[parentCode] += 1;
                    districtFeaturesByCode.set(code, feature);
                    districtBoundsByCode.set(code, boundsLayer.getBounds());
                    const fill = L.geoJSON(feature, {
                        pane: 'districtFillPane',
                        interactive: false,
                        style: districtStyle(parentCode, index)
                    });
                    layerGroups.adminDistricts.addLayer(fill);
                    addBoundaryLines(layerGroups.adminDistricts, feature, {
                        pane: 'districtOutlinePane',
                        color: parentCode === '96.71' ? '#88769f' : '#829269',
                        weight: 0.9,
                        opacity: 0.9
                    }, createBoundaryPopup(name, parentName, code, 'Batas distrik BIG'));
                    const districtLabel = addAdminLabel(layerGroups.adminDistricts, properties.label_point, properties.WADMKC, 'admin-district-label');
                    districtLabelsByCode.set(code, districtLabel);

                    const option = document.createElement('option');
                    option.value = `district:${code}`;
                    option.textContent = fullLabel;
                    regionFilter.querySelector('#district-filter-options').appendChild(option);
                });
                updateDistrictLayerVisibility();
                setAdminStatus(districtStatus, `${districtFeaturesByCode.size} distrik BIG tersedia (${counts['96.01']} Kabupaten Sorong, ${counts['96.71']} Kota Sorong); batas tampil mulai zoom ${districtMinZoom}.`, false);
            })
            .catch(error => {
                console.error('Gagal memuat batas distrik BIG:', error);
                setAdminStatus(districtStatus, 'Batas administrasi distrik belum tersedia.', true);
                districtLayerCheckbox.disabled = true;
                const option = document.createElement('option');
                option.disabled = true;
                option.textContent = 'Batas distrik belum tersedia';
                regionFilter.querySelector('#district-filter-options').appendChild(option);
            });
    }

    Promise.all([loadParentBoundaries(), loadDistrictBoundaries()]).then(loadDailyHotspots);
    map.on('zoomend', updateDistrictLayerVisibility);

    // 3. FUNGSI PEMODELAN DISPERSI ASAP (GAUSSIAN PLUME SEDERHANA)
    // Menghitung poligon elips memanjang searah vektor angin dari titik sumber api
    function generatePlumePolygon(lat, lng, distanceKm, spreadKm, bearingDeg) {
        const points = [];
        const radBearing = (bearingDeg * Math.PI) / 180;
        const steps = 36;

        // Konversi km ke derajat sekitar lintang Sorong (-1 deg)
        const kmPerDegLat = 110.574;
        const kmPerDegLng = 111.320 * Math.cos((lat * Math.PI) / 180);

        for (let i = 0; i <= steps; i++) {
            const angle = (i / steps) * 2 * Math.PI;
            // Bentuk teardrop / plume memanjang ke arah downwind
            const along = (Math.cos(angle) + 1) * 0.5 * distanceKm; 
            // Lebar plume membesar seiring jarak downwind
            const widthFactor = Math.pow(along / distanceKm, 0.65);
            const cross = Math.sin(angle) * spreadKm * (0.25 + 0.75 * widthFactor);

            // Rotasi koordinat lokal ke arah angin (bearingDeg: 0 = Utara/+Lat, 90 = Timur/+Lng)
            const dNorth = along * Math.cos(radBearing) - cross * Math.sin(radBearing);
            const dEast = along * Math.sin(radBearing) + cross * Math.cos(radBearing);

            const pLat = lat + (dNorth / kmPerDegLat);
            const pLng = lng + (dEast / kmPerDegLng);
            points.push([pLat, pLng]);
        }
        return points;
    }

    // Helper Jarak Haversine (km)
    function getDistanceKm(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    function plumeContributionAtPoint(lat, lng, sources) {
        let total = 0;
        const radWind = (simState.windDir * Math.PI) / 180;

        sources.forEach(hs => {
            const frpValue = optionalNumber(hs.frp);
            const frp = frpValue == null ? 1 : frpValue;
            const dist = getDistanceKm(hs.lat, hs.lng, lat, lng);
            if (dist < 0.5) {
                total += frp * simState.frpMult * 4.5;
                return;
            }

            // Hitung sudut dari hotspot ke target
            const dLat = (lat - hs.lat) * 110.574;
            const dLng = (lng - hs.lng) * 111.320 * Math.cos((hs.lat * Math.PI) / 180);

            // Proyeksi searah angin (downwind) dan tegak lurus angin (crosswind)
            const downwind = dLat * Math.cos(radWind) + dLng * Math.sin(radWind);
            const crosswind = Math.abs(-dLat * Math.sin(radWind) + dLng * Math.cos(radWind));

            const maxReach = 8 + simState.windSpeed * 2.4; // Jangkauan max km
            if (downwind > -1 && downwind <= maxReach) {
                const effectiveDownwind = Math.max(0.5, downwind);
                const sigmaY = 1.2 + effectiveDownwind * (0.28 - simState.windSpeed * 0.008);

                // Persamaan Gaussian Plume 2D terkalibrasi
                const emission = (frp * simState.frpMult) * 16;
                const decay = Math.exp(-0.07 * effectiveDownwind);
                const crossFactor = Math.exp(-(crosswind * crosswind) / (2 * sigmaY * sigmaY));

                const contribution = (emission / (simState.windSpeed * 0.6 + 1.5)) * decay * crossFactor;
                total += contribution;
            }
        });

        return total;
    }

    // Estimasi Konsentrasi PM2.5 ilustratif untuk skenario manual.
    function estimatePM25AtPoint(lat, lng) {
        return Math.min(480, Math.round(12 + plumeContributionAtPoint(lat, lng, hotspots)));
    }

    function getAirQualityCategory(pm) {
        if (pm > 250) return { label: 'BERBAHAYA', color: '#ef4444', badge: 'bg-red-950 text-red-300 border-red-700' };
        if (pm > 150) return { label: 'SANGAT TIDAK SEHAT', color: '#f87171', badge: 'bg-red-900/60 text-red-200 border-red-500' };
        if (pm > 55)  return { label: 'TIDAK SEHAT', color: '#fb923c', badge: 'bg-orange-900/60 text-orange-200 border-orange-500' };
        if (pm > 15)  return { label: 'SEDANG', color: '#facc15', badge: 'bg-yellow-900/50 text-yellow-200 border-yellow-500' };
        return { label: 'BAIK', color: '#4ade80', badge: 'bg-emerald-900/50 text-emerald-200 border-emerald-500' };
    }

    // 4. RENDER SEMUA LAYER PETA
    let currentPlumeGeoJSON = { type: "FeatureCollection", features: [] };

    function renderAllLayers() {
        // Bersihkan layer dinamis
        layerGroups.burned.clearLayers();
        layerGroups.aod.clearLayers();
        layerGroups.plume.clearLayers();
        layerGroups.wind.clearLayers();
        layerGroups.hotspots.clearLayers();
        layerGroups.facilities.clearLayers();

        currentPlumeGeoJSON.features = [];

        // A. Hitung estimasi paparan distrik tanpa menggambar poligon skenario.
        let totalExposedPop = 0;
        const districtPMList = [];

        districtsData.forEach(dist => {
            // Sampling beberapa titik dalam distrik untuk rata-rata & max PM2.5
            const pmCenter = estimatePM25AtPoint(dist.center[0], dist.center[1]);
            const pmCorner = estimatePM25AtPoint(dist.coords[0][0], dist.coords[0][1]);
            const peakPM = Math.max(pmCenter, pmCorner);
            const avgPM = Math.round((pmCenter + pmCorner) / 2);

            districtPMList.push({ name: dist.name, pm: peakPM });

            // Hitung estimasi populasi terpapar zona Tidak Sehat (> 55 ug/m3)
            let exposedRatio = 0;
            if (peakPM > 150) exposedRatio = 0.65;
            else if (peakPM > 55) exposedRatio = 0.30;
            else if (avgPM > 45) exposedRatio = 0.12;

            const exposedCount = Math.round(dist.pop * exposedRatio);
            totalExposedPop += exposedCount;

        });

        // B. Render Plume Sebaran Asap (4 Zona Konsentrasi Konsentris per Hotspot)
        const baseLength = 7 + simState.windSpeed * 2.2;
        const baseSpread = Math.max(1.8, 5.2 - simState.windSpeed * 0.2);

        const plumeTiers = [
            { scaleL: 1.00, scaleW: 1.00, color: '#eab308', label: 'Sedang (15-55 µg/m³)', pmVal: 42, opMult: 0.55 },
            { scaleL: 0.72, scaleW: 0.72, color: '#f97316', label: 'Tidak Sehat (55-150 µg/m³)', pmVal: 115, opMult: 0.75 },
            { scaleL: 0.44, scaleW: 0.45, color: '#dc2626', label: 'Sangat Tidak Sehat (150-250 µg/m³)', pmVal: 195, opMult: 0.90 },
            { scaleL: 0.22, scaleW: 0.24, color: '#7f1d1d', label: 'Berbahaya (>250 µg/m³)', pmVal: 310, opMult: 1.0 }
        ];

        hotspots.forEach(hs => {
            const frpFactor = (hs.frp / 55) * simState.frpMult;
            const len = baseLength * Math.min(1.6, Math.max(0.6, frpFactor));
            const spr = baseSpread * Math.min(1.4, Math.max(0.7, frpFactor));

            // Area Terbakar (Burned Area polygon kecil di sekitar hotspot)
            const burnedRadius = 0.006 * Math.sqrt(frpFactor);
            L.circle([hs.lat, hs.lng], {
                radius: burnedRadius * 111000,
                color: '#b45309',
                weight: 1,
                fillColor: '#451a03',
                fillOpacity: 0.65
            }).addTo(layerGroups.burned).bindPopup(`
                <div class="text-xs">
                    <b class="text-amber-400">Bekas Area Terbakar (MCD64A1)</b><br>
                    Sumber: ${hs.id} • Tutupan: ${hs.land}
                </div>
            `);

            // Layer Validasi AOD Satelit (Grid kasar Himawari-9)
            L.rectangle([
                [hs.lat - 0.03, hs.lng - 0.04],
                [hs.lat + 0.09, hs.lng - 0.11]
            ], {
                color: '#a855f7',
                weight: 1,
                dashArray: '3,3',
                fillColor: '#9333ea',
                fillOpacity: 0.22
            }).addTo(layerGroups.aod).bindPopup(`
                <div class="text-xs">
                    <b class="text-purple-400">Validasi Aerosol Optical Depth (AOD)</b><br>
                    Sensor: Himawari-9 / TROPOMI<br>
                    Indeks AOD: <b>0.84 (Tinggi)</b> • Korelasi Model: <b>r = 0.81</b>
                </div>
            `);

            // Render Plume Tiers
            plumeTiers.forEach(tier => {
                const polyCoords = generatePlumePolygon(
                    hs.lat, hs.lng,
                    len * tier.scaleL,
                    spr * tier.scaleW,
                    simState.windDir
                );

                const adjustedPM = Math.round(tier.pmVal * simState.frpMult);

                const plumePoly = L.polygon(polyCoords, {
                    color: tier.color,
                    weight: 0.8,
                    opacity: simState.plumeOpacity * 0.8,
                    fillColor: tier.color,
                    fillOpacity: Math.min(0.92, simState.plumeOpacity * tier.opMult)
                }).addTo(layerGroups.plume);

                plumePoly.bindPopup(`
                    <div class="text-xs space-y-1">
                        <div class="font-bold text-teal-400">Model Dispersi Asap (Plume)</div>
                        <div>Sumber Emisi: <b>${hs.id}</b> (FRP: ${hs.frp} MW)</div>
                        <div>Zona Kualitas: <b>${tier.label}</b></div>
                        <div>Est. Konsentrasi: <b>~${adjustedPM} µg/m³</b></div>
                        <div>Arah Angin: <b>${simState.windDir}°</b> (${simState.windSpeed} m/s)</div>
                    </div>
                `);

                // Simpan ke GeoJSON untuk fitur Unduh
                currentPlumeGeoJSON.features.push({
                    type: "Feature",
                    properties: {
                        source_id: hs.id,
                        zone: tier.label,
                        status: "skenario_ilustratif",
                        nilai_pm25_skenario: adjustedPM,
                        wind_direction_deg: simState.windDir,
                        wind_speed_ms: simState.windSpeed,
                        frp_mw: hs.frp
                    },
                    geometry: {
                        type: "Polygon",
                        coordinates: [polyCoords.map(c => [c[1], c[0]])]
                    }
                });
            });

            // C. Render Titik Api (Hotspot Marker)
            const fireIcon = L.divIcon({
                className: 'custom-fire-icon',
                html: `<div class="w-4 h-4 fire-marker-icon flex items-center justify-center"><i class="fas fa-fire text-[8px] text-white"></i></div>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });

            L.marker([hs.lat, hs.lng], { icon: fireIcon })
                .addTo(layerGroups.hotspots)
                .bindPopup(`
                    <div class="text-xs space-y-1 min-w-[190px]">
                        <div class="flex items-center justify-between">
                            <span class="font-bold text-red-400"><i class="fas fa-fire"></i> Titik Api ${hs.id}</span>
                            <span class="px-1.5 py-0.5 bg-red-950 text-red-300 rounded text-[10px]">${hs.conf}</span>
                        </div>
                        <div>Koordinat: <b>${hs.lat.toFixed(4)}, ${hs.lng.toFixed(4)}</b></div>
                        <div>FRP: <b>${(hs.frp * simState.frpMult).toFixed(1)} MW</b></div>
                        <div>Tutupan: ${hs.land}</div>
                    </div>
                `);
        });

        // D. Render Vektor Arah Angin di beberapa titik grid Sorong
        const windGrid = [
            [-0.87, 131.25], [-0.93, 131.32], [-1.01, 131.38],
            [-1.07, 131.44], [-0.96, 131.26], [-1.04, 131.31]
        ];
        windGrid.forEach(pt => {
            const arrowIcon = L.divIcon({
                className: 'wind-arrow-icon',
                html: `<div style="transform: rotate(${simState.windDir - 45}deg);" class="text-cyan-400/80 text-sm drop-shadow"><i class="fas fa-location-arrow"></i></div>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });
            L.marker(pt, { icon: arrowIcon, interactive: false }).addTo(layerGroups.wind);
        });

        // E. Render Objek Vital & Hitung Dampak Fasilitas
        let affectedHealth = 0;
        let totalHealth = 0;
        let affectedSchools = 0;
        let airportPM = 15;
        const vitalListEl = document.getElementById('vital-list');
        vitalListEl.innerHTML = '';

        vitalFacilities.forEach(fac => {
            const pm = estimatePM25AtPoint(fac.lat, fac.lng);
            const cat = getAirQualityCategory(pm);
            const isAffected = pm > 55;

            if (fac.type === 'health') {
                totalHealth++;
                if (isAffected) affectedHealth++;
            }
            if (fac.type === 'school' && isAffected) {
                affectedSchools += (fac.count || 1);
            }
            if (fac.type === 'airport') {
                airportPM = pm;
            }

            const badgeColor = isAffected ? 'bg-red-600 border-yellow-300' : 'bg-slate-800 border-teal-400';
            const facIcon = L.divIcon({
                className: 'fac-marker',
                html: `<div class="w-6 h-6 rounded-full ${badgeColor} border-2 text-white flex items-center justify-center shadow-md text-[10px]">
                        <i class="fas ${fac.icon}"></i>
                       </div>`,
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            });

            L.marker([fac.lat, fac.lng], { icon: facIcon })
                .addTo(layerGroups.facilities)
                .bindPopup(`
                    <div class="text-xs space-y-1 min-w-[200px]">
                        <div class="text-[10px] text-slate-400">${fac.district}</div>
                        <div class="font-bold text-white">${fac.name}</div>
                        <div class="flex justify-between pt-1 border-t border-slate-700">
                            <span>Konsentrasi PM2.5:</span>
                            <b style="color:${cat.color}">${pm} µg/m³</b>
                        </div>
                        <div class="text-center py-1 rounded border text-[10px] font-bold ${cat.badge}">${cat.label}</div>
                    </div>
                `);

            // Tambah ke daftar sidebar kanan
            vitalListEl.innerHTML += `
                <div class="flex items-center justify-between p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                    <div class="flex items-center gap-2 overflow-hidden">
                        <i class="fas ${fac.icon} text-slate-400 text-[11px] shrink-0"></i>
                        <div class="truncate">
                            <div class="text-slate-200 font-medium truncate">${fac.name}</div>
                            <div class="text-[10px] text-slate-500">${fac.district}</div>
                        </div>
                    </div>
                    <span class="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border shrink-0 ml-2 ${cat.badge}">
                        ${pm} µg
                    </span>
                </div>
            `;
        });

        // 5. UPDATE KPI CARDS & CHART
        document.getElementById('kpi-pop').textContent = totalExposedPop.toLocaleString('id-ID');
        document.getElementById('kpi-health').innerHTML = `${affectedHealth} <span class="text-xs font-normal text-slate-400">/ ${totalHealth} Unit</span>`;
        document.getElementById('kpi-school').innerHTML = `${affectedSchools} <span class="text-xs font-normal text-slate-400">Sekolah</span>`;

        // Status Visibilitas Bandara DEO berdasarkan rumus empiris PM2.5 -> Visibility (km)
        const estVisKm = Math.max(0.6, (260 / Math.max(25, airportPM))).toFixed(1);
        const airportEl = document.getElementById('kpi-airport');
        if (airportPM > 150) {
            airportEl.textContent = `TERGANGGU (${estVisKm} km)`;
            airportEl.className = 'text-sm font-bold text-red-400 mt-0.5';
        } else if (airportPM > 55) {
            airportEl.textContent = `WASPADA (${estVisKm} km)`;
            airportEl.className = 'text-sm font-bold text-amber-400 mt-0.5';
        } else {
            airportEl.textContent = `NORMAL (> 8 km)`;
            airportEl.className = 'text-sm font-bold text-emerald-400 mt-0.5';
        }
        document.getElementById('kpi-airport-pm').textContent = `PM2.5: ${airportPM} µg/m³`;

        updateDistrictChart(districtPMList);
    }

    // 6. INISIALISASI CHART.JS
    const ctx = document.getElementById('districtChart').getContext('2d');
    const districtChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'PM2.5 (µg/m³)',
                data: [],
                backgroundColor: [],
                borderRadius: 6,
                barThickness: 18
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 350,
                    grid: { color: '#1e293b' },
                    ticks: { color: '#94a3b8', font: { size: 10 } }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#cbd5e1', font: { size: 9 } }
                }
            }
        }
    });

    function updateDistrictChart(list) {
        districtChart.data.labels = list.map(d => d.name.replace('Distrik ', ''));
        districtChart.data.datasets[0].data = list.map(d => d.pm);
        districtChart.data.datasets[0].backgroundColor = list.map(d => {
            if (d.pm > 250) return '#991b1b';
            if (d.pm > 150) return '#dc2626';
            if (d.pm > 55) return '#f97316';
            return '#eab308';
        });
        districtChart.update();
    }

    const monthNamesId = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const monthNamesShortId = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    function dailyDateLabel(index) {
        const date = new Date(`${dailyDates[index]}T00:00:00Z`);
        return `${date.getUTCDate()} ${monthNamesId[date.getUTCMonth()]} ${date.getUTCFullYear()} · Hari ${index + 1} dari 25`;
    }

    function dailyDateIndex(dateText) {
        return dailyDates.indexOf(dateText);
    }

    function normalizeAcquisitionTime(value) {
        const digits = String(value == null ? '' : value).trim().replace(':', '');
        if (!/^\d{1,4}$/.test(digits)) return null;
        const padded = digits.padStart(4, '0');
        const hour = Number(padded.slice(0, 2));
        const minute = Number(padded.slice(2, 4));
        if (hour > 23 || minute > 59) return null;
        return { hhmm: padded, hour, minute };
    }

    function acquisitionDateWit(dateText, timeValue) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || '').trim());
        const time = normalizeAcquisitionTime(timeValue);
        if (!match || !time) return null;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const utc = new Date(Date.UTC(year, month - 1, day, time.hour, time.minute));
        if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
        const wit = new Date(utc.getTime() + 9 * 60 * 60 * 1000);
        return { date: wit.toISOString().slice(0, 10), hhmm: time.hhmm };
    }

    function optionalNumber(value) {
        if (value == null || String(value).trim() === '') return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function pointInRing(lng, lat, ring) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0];
            const yi = ring[i][1];
            const xj = ring[j][0];
            const yj = ring[j][1];
            const cross = (lng - xi) * (yj - yi) - (lat - yi) * (xj - xi);
            if (Math.abs(cross) < 1e-10 &&
                lng >= Math.min(xi, xj) - 1e-10 && lng <= Math.max(xi, xj) + 1e-10 &&
                lat >= Math.min(yi, yj) - 1e-10 && lat <= Math.max(yi, yj) + 1e-10) return true;
            if ((yi > lat) !== (yj > lat) &&
                lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    }

    function pointInPolygonCoordinates(lng, lat, rings) {
        if (!rings.length || !pointInRing(lng, lat, rings[0])) return false;
        for (let i = 1; i < rings.length; i++) {
            if (pointInRing(lng, lat, rings[i])) return false;
        }
        return true;
    }

    function pointInGeometry(lng, lat, geometry) {
        if (!geometry) return false;
        if (geometry.type === 'Polygon') return pointInPolygonCoordinates(lng, lat, geometry.coordinates);
        if (geometry.type === 'MultiPolygon') {
            return geometry.coordinates.some(polygon => pointInPolygonCoordinates(lng, lat, polygon));
        }
        return false;
    }

    function classifyCoordinates(lat, lng) {
        for (const [parentCode, feature] of parentFeaturesByCode.entries()) {
            const bounds = parentBoundsByCode.get(parentCode);
            if ((!bounds || bounds.contains([lat, lng])) && pointInGeometry(lng, lat, feature.geometry)) {
                let districtCode = null;
                for (const [code, district] of districtFeaturesByCode.entries()) {
                    if (String(district.properties.KDPKAB) === parentCode &&
                        pointInGeometry(lng, lat, district.geometry)) {
                        districtCode = code;
                        break;
                    }
                }
                return { parentCode, districtCode };
            }
        }
        return null;
    }

    function dailyRecordKey(record) {
        const frpValue = optionalNumber(record.frp);
        const frp = frpValue == null ? '' : frpValue.toFixed(3);
        return [
            record.acqDateUtc,
            record.acqTimeUtc,
            Number(record.lat).toFixed(5),
            Number(record.lng).toFixed(5),
            frp,
            String(record.confidence || '').toLowerCase()
        ].join('|');
    }

    function addDailyRecord(record) {
        const key = dailyRecordKey(record);
        if (dailyRecordKeys.has(key)) return false;
        dailyRecordKeys.add(key);
        dailyRecords.push(record);
        return true;
    }

    function parentRegionName(code) {
        return code === '96.71' ? 'Kota Sorong' : code === '96.01' ? 'Kabupaten Sorong' : 'Di luar wilayah kajian';
    }

    function currentRegionLabel() {
        const value = regionFilter.value;
        if (value === 'kota_sorong') return 'Kota Sorong';
        if (value === 'kabupaten_sorong') return 'Kabupaten Sorong';
        if (value.indexOf('district:') === 0) {
            const feature = districtFeaturesByCode.get(value.slice('district:'.length));
            if (feature) return `Distrik ${feature.properties.WADMKC} · ${parentRegionName(String(feature.properties.KDPKAB))}`;
        }
        return 'Seluruh wilayah kajian · Kota dan Kabupaten Sorong';
    }

    function recordMatchesCurrentRegion(record) {
        const value = regionFilter.value;
        if (value === 'all') return true;
        if (value === 'kota_sorong') return record.parentCode === '96.71';
        if (value === 'kabupaten_sorong') return record.parentCode === '96.01';
        if (value.indexOf('district:') === 0) return record.districtCode === value.slice('district:'.length);
        return false;
    }

    function recordsForDate(dateText) {
        return dailyRecords.filter(record => record.witDate === dateText && record.parentCode);
    }

    function makeDailyPopup(record) {
        const wrapper = document.createElement('div');
        wrapper.className = 'text-xs space-y-1';
        const title = document.createElement('strong');
        title.textContent = 'Titik panas VIIRS/FIRMS';
        wrapper.appendChild(title);
        const fields = [
            `Wilayah: ${parentRegionName(record.parentCode)}`,
            `Tanggal WIT: ${record.witDate}`,
            `Akuisisi UTC: ${record.acqDateUtc} ${record.acqTimeUtc} UTC`,
            `FRP: ${record.frp == null ? 'tidak tersedia; simulasi memakai bobot relatif 1' : `${record.frp} (satuan belum terverifikasi)`}`,
            `Confidence: ${record.confidence || 'tidak tersedia'}`,
            `Sumber: ${record.sourceLabel}`
        ];
        fields.forEach(text => {
            const row = document.createElement('div');
            row.textContent = text;
            wrapper.appendChild(row);
        });
        return wrapper;
    }

    function addDailySmokeOverlay(sources) {
        const width = 168;
        const height = 152;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        const image = context.createImageData(width, height);
        const north = dailySmokeBounds.getNorth();
        const south = dailySmokeBounds.getSouth();
        const east = dailySmokeBounds.getEast();
        const west = dailySmokeBounds.getWest();
        const palette = [
            { stop: 0.06, color: [255, 246, 190] },
            { stop: 0.32, color: [249, 180, 95] },
            { stop: 0.62, color: [229, 94, 52] },
            { stop: 1, color: [147, 32, 48] }
        ];

        for (let y = 0; y < height; y++) {
            const lat = north - (y + 0.5) / height * (north - south);
            for (let x = 0; x < width; x++) {
                const lng = west + (x + 0.5) / width * (east - west);
                const intensity = Math.min(1, plumeContributionAtPoint(lat, lng, sources) / dailySmokeScale);
                const offset = (y * width + x) * 4;
                if (intensity < 0.025) continue;

                let lower = palette[0];
                let upper = palette[palette.length - 1];
                for (let p = 1; p < palette.length; p++) {
                    if (intensity <= palette[p].stop) {
                        lower = palette[p - 1];
                        upper = palette[p];
                        break;
                    }
                }
                const amount = Math.max(0, Math.min(1, (intensity - lower.stop) / (upper.stop - lower.stop)));
                for (let channel = 0; channel < 3; channel++) {
                    image.data[offset + channel] = Math.round(lower.color[channel] + (upper.color[channel] - lower.color[channel]) * amount);
                }
                image.data[offset + 3] = Math.round(Math.min(0.82, simState.plumeOpacity * 1.15) * Math.pow(intensity, 0.42) * 255);
            }
        }
        context.putImageData(image, 0, 0);
        L.imageOverlay(canvas.toDataURL('image/png'), dailySmokeBounds, {
            opacity: 1,
            pane: 'dailySmokePane',
            interactive: false,
            className: 'daily-smoke-image'
        }).addTo(layerGroups.dailySmoke);
    }

    function updateDailyChart() {
        if (!dailyChart) {
            dailyChart = new Chart(document.getElementById('dailyChart').getContext('2d'), {
                type: 'bar',
                data: {
                    labels: dailyDates.map(date => {
                        const parsed = new Date(`${date}T00:00:00Z`);
                        return `${parsed.getUTCDate()} ${monthNamesShortId[parsed.getUTCMonth()]}`;
                    }),
                    datasets: [
                        { label: 'Kota Sorong', data: [], backgroundColor: '#a78bfa', borderRadius: 3 },
                        { label: 'Kabupaten Sorong', data: [], backgroundColor: '#a3b18a', borderRadius: 3 }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: true, labels: { color: '#cbd5e1', boxWidth: 10, font: { size: 9 } } },
                        tooltip: {
                            callbacks: {
                                label: context => `${context.dataset.label}: ${context.parsed.y} rekaman sumber`
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: { precision: 0, color: '#94a3b8', font: { size: 9 } },
                            grid: { color: '#1e293b' }
                        },
                        x: { ticks: { color: '#94a3b8', font: { size: 8 }, maxRotation: 0 }, grid: { display: false } }
                    }
                }
            });
        }
        const city = dailyDates.map(date => {
            const count = dailyRecords.filter(record => record.witDate === date && record.parentCode === '96.71').length;
            return count ? count : null;
        });
        const county = dailyDates.map(date => {
            const count = dailyRecords.filter(record => record.witDate === date && record.parentCode === '96.01').length;
            return count ? count : null;
        });
        dailyChart.data.datasets[0].data = city;
        dailyChart.data.datasets[1].data = county;
        dailyChart.update();
    }

    function updateDailyDay() {
        const dateText = dailyDates[dailyCurrentIndex];
        const dayLabel = dailyDateLabel(dailyCurrentIndex);
        const dayRecords = recordsForDate(dateText);
        const visibleRecords = dayRecords.filter(recordMatchesCurrentRegion);
        const cityCount = dayRecords.filter(record => record.parentCode === '96.71').length;
        const countyCount = dayRecords.filter(record => record.parentCode === '96.01').length;

        document.getElementById('daily-date-label').textContent = dayLabel;
        document.getElementById('daily-date-picker').value = dateText;
        document.getElementById('daily-date-slider').value = dailyCurrentIndex;
        document.getElementById('daily-prev-btn').disabled = dailyCurrentIndex === 0;
        document.getElementById('daily-next-btn').disabled = dailyCurrentIndex === dailyDates.length - 1;
        document.getElementById('daily-prev-btn').classList.toggle('opacity-50', dailyCurrentIndex === 0);
        document.getElementById('daily-next-btn').classList.toggle('opacity-50', dailyCurrentIndex === dailyDates.length - 1);
        document.getElementById('daily-summary-date').textContent = dayLabel;
        document.getElementById('daily-summary-region').textContent = `Wilayah: ${currentRegionLabel()}`;
        document.getElementById('daily-summary-source').textContent = `${dailySourceLabel}. ` + (visibleRecords.length
            ? `${visibleRecords.length} rekaman hotspot dalam berkas pada tanggal WIT ini. Cakupan pengamatan tidak tercantum, jadi data kosong bukan bukti nihil hotspot.`
            : 'Data hotspot belum tersedia untuk tanggal/wilayah ini; cakupan pengamatan harian tidak terkonfirmasi.');
        document.getElementById('daily-city-count').textContent = cityCount ? `${cityCount} rekaman` : 'Data hotspot belum tersedia';
        document.getElementById('daily-county-count').textContent = countyCount ? `${countyCount} rekaman` : 'Data hotspot belum tersedia';
        const modelMessage = dailySmokeMethod.value === 'hysplit'
            ? 'Hasil HYSPLIT belum tersedia untuk tanggal ini.'
            : 'Hasil HYSPLIT belum tersedia untuk tanggal ini; overlay aktif adalah simulasi ilustratif.';
        document.getElementById('daily-model-status').textContent = modelMessage;
        document.getElementById('daily-smoke-status').textContent = dailySmokeMethod.value === 'hysplit'
            ? modelMessage
            : !dailySmokeToggle.checked
                ? 'Gradasi asap disembunyikan; simbol hotspot tetap dapat ditampilkan.'
                : visibleRecords.length
                    ? `Satu hamparan ilustratif dari ${visibleRecords.length} sumber untuk tanggal/wilayah terpilih; FRP yang tidak tersedia memakai bobot relatif 1.`
                    : 'Data hotspot belum tersedia untuk tanggal/wilayah ini; gradasi hari sebelumnya telah dibersihkan.';
        document.getElementById('daily-wind-status').textContent =
            `Angin simulasi: ${simState.windDir}° ${getCompassLabel(simState.windDir)} · ${simState.windSpeed.toFixed(1)} m/s · FRP ×${simState.frpMult.toFixed(1)}`;
        document.getElementById('daily-facility-status').textContent =
            'Daftar fasilitas yang tersedia berasal dari skenario manual; sumber dan validasi lokasinya tidak tercatat. Nilai paparan harian tidak dihitung.';

        layerGroups.dailyHotspots.clearLayers();
        visibleRecords.forEach(record => {
            const marker = L.circleMarker([record.lat, record.lng], {
                pane: 'dailyHotspotPane',
                radius: 4,
                color: record.parentCode === '96.71' ? '#ddd6fe' : '#d9e3bd',
                weight: 1.2,
                fillColor: record.parentCode === '96.71' ? '#8b5cf6' : '#6f8b57',
                fillOpacity: 0.95
            });
            marker.bindPopup(makeDailyPopup(record), { maxWidth: 280 });
            layerGroups.dailyHotspots.addLayer(marker);
        });

        layerGroups.dailyFacilities.clearLayers();
        const selectedFacilities = vitalFacilities.filter(facility => {
            const classification = classifyCoordinates(facility.lat, facility.lng);
            return classification && (regionFilter.value === 'all' ||
                (regionFilter.value === 'kota_sorong' && classification.parentCode === '96.71') ||
                (regionFilter.value === 'kabupaten_sorong' && classification.parentCode === '96.01') ||
                (regionFilter.value.indexOf('district:') === 0 && classification.districtCode === regionFilter.value.slice('district:'.length)));
        });
        selectedFacilities.forEach(facility => {
            const marker = L.circleMarker([facility.lat, facility.lng], {
                pane: 'dailyFacilityPane',
                radius: 5,
                color: '#99f6e4',
                weight: 1.5,
                fillColor: '#0f766e',
                fillOpacity: 0.9
            });
            const popup = document.createElement('div');
            popup.className = 'text-xs';
            const facilityTitle = document.createElement('strong');
            facilityTitle.textContent = facility.name;
            popup.appendChild(facilityTitle);
            const facilityInfo = document.createElement('div');
            facilityInfo.textContent = `${facility.district} · lokasi skenario manual; tidak ada nilai paparan harian terverifikasi.`;
            popup.appendChild(facilityInfo);
            marker.bindPopup(popup);
            layerGroups.dailyFacilities.addLayer(marker);
        });

        if (isDailyMode) {
            const layerPreferences = {
                'layer-hotspots': dailyHotspotsToggle.checked && document.getElementById('layer-hotspots').checked,
                'layer-facilities': document.getElementById('layer-facilities').checked,
                'layer-plume': dailySmokeToggle.checked && document.getElementById('layer-plume').checked
            };
            Object.keys(layerPreferences).forEach(id => {
                const group = id === 'layer-hotspots' ? layerGroups.dailyHotspots :
                    id === 'layer-facilities' ? layerGroups.dailyFacilities : layerGroups.dailySmoke;
                if (id === 'layer-plume') {
                    layerGroups.dailySmoke.clearLayers();
                    if (dailySmokeToggle.checked && dailySmokeMethod.value === 'simulation' && visibleRecords.length) {
                        addDailySmokeOverlay(visibleRecords);
                    }
                }
                if (layerPreferences[id]) map.addLayer(group);
                else map.removeLayer(group);
            });
        }
        document.getElementById('daily-export-btn').disabled = visibleRecords.length === 0;
        document.getElementById('daily-export-btn').classList.toggle('opacity-50', visibleRecords.length === 0);
        updateDailyChart();
    }

    function stopDailyPlayback() {
        if (dailyTimer !== null) {
            clearInterval(dailyTimer);
            dailyTimer = null;
        }
        dailyPlayButton.textContent = dailyCurrentIndex === dailyDates.length - 1 ? 'Putar ulang' : 'Play';
        dailyPlayButton.setAttribute('aria-label', dailyCurrentIndex === dailyDates.length - 1 ? 'Putar ulang perkembangan harian' : 'Putar perkembangan harian');
    }

    function setDailyIndex(index) {
        dailyCurrentIndex = Math.max(0, Math.min(dailyDates.length - 1, Number(index)));
        updateDailyDay();
        if (dailyTimer === null) stopDailyPlayback();
    }

    function startDailyPlayback() {
        if (dailyTimer !== null) {
            stopDailyPlayback();
            return;
        }
        if (dailyCurrentIndex === dailyDates.length - 1) setDailyIndex(0);
        dailyPlayButton.textContent = 'Jeda';
        dailyPlayButton.setAttribute('aria-label', 'Jeda perkembangan harian');
        dailyTimer = setInterval(() => {
            if (dailyCurrentIndex >= dailyDates.length - 1) {
                stopDailyPlayback();
                return;
            }
            setDailyIndex(dailyCurrentIndex + 1);
            if (dailyCurrentIndex === dailyDates.length - 1) stopDailyPlayback();
        }, 1200);
    }

    function setDailyMode(enabled) {
        if (isDailyMode === enabled) return;
        isDailyMode = enabled;
        if (enabled) {
            manualSettingsSnapshot = {
                windDir: simState.windDir,
                windSpeed: simState.windSpeed,
                frpMult: simState.frpMult,
                plumeOpacity: simState.plumeOpacity,
                timeValue: document.getElementById('time-slider').value
            };
        } else {
            stopDailyPlayback();
            if (manualSettingsSnapshot) {
                simState.windDir = manualSettingsSnapshot.windDir;
                simState.windSpeed = manualSettingsSnapshot.windSpeed;
                simState.frpMult = manualSettingsSnapshot.frpMult;
                simState.plumeOpacity = manualSettingsSnapshot.plumeOpacity;
                document.getElementById('sim-wind-dir').value = simState.windDir;
                document.getElementById('wind-dir-display').textContent = `${simState.windDir}° (${getCompassLabel(simState.windDir)})`;
                document.getElementById('sim-wind-speed').value = simState.windSpeed;
                document.getElementById('wind-speed-display').textContent = `${simState.windSpeed.toFixed(1)} m/s`;
                document.getElementById('sim-frp-mult').value = simState.frpMult;
                document.getElementById('frp-mult-display').textContent = `${simState.frpMult.toFixed(1)}x`;
                document.getElementById('plume-opacity-slider').value = Math.round(simState.plumeOpacity * 100);
                document.getElementById('plume-opacity-val').textContent = `${Math.round(simState.plumeOpacity * 100)}%`;
                document.getElementById('time-slider').value = manualSettingsSnapshot.timeValue;
            }
        }
        document.getElementById('daily-source-panel').classList.toggle('hidden', !enabled);
        document.querySelectorAll('.manual-only-layer').forEach(element => element.classList.toggle('hidden', enabled));
        document.getElementById('manual-timebar').classList.toggle('hidden', enabled);
        document.getElementById('daily-timebar').classList.toggle('hidden', !enabled);
        document.getElementById('manual-plume-legend').classList.toggle('hidden', enabled);
        document.getElementById('daily-plume-legend').classList.toggle('hidden', !enabled);
        document.getElementById('manual-analysis-content').classList.toggle('hidden', enabled);
        document.getElementById('daily-analysis-content').classList.toggle('hidden', !enabled);
        document.getElementById('right-sidebar-title').innerHTML = enabled
            ? '<i class="fas fa-calendar-day text-amber-400"></i> Perkembangan Harian'
            : '<i class="fas fa-chart-pie text-teal-400"></i> Ringkasan Analisis Dampak';

        [layerGroups.burned, layerGroups.aod, layerGroups.plume, layerGroups.wind, layerGroups.hotspots, layerGroups.facilities].forEach(group => map.removeLayer(group));
        if (!enabled) {
            map.removeLayer(layerGroups.dailySmoke);
            map.removeLayer(layerGroups.dailyHotspots);
            map.removeLayer(layerGroups.dailyFacilities);
            Object.entries({
                'layer-burned': layerGroups.burned,
                'layer-wind': layerGroups.wind,
                'layer-plume': layerGroups.plume,
                'layer-aod': layerGroups.aod,
                'layer-hotspots': layerGroups.hotspots,
                'layer-facilities': layerGroups.facilities
            }).forEach(([id, group]) => {
                if (document.getElementById(id).checked) map.addLayer(group);
            });
            renderAllLayers();
        } else {
            document.getElementById('daily-opacity-slider').value = Math.round(simState.plumeOpacity * 100);
            document.getElementById('daily-opacity-value').textContent = `${Math.round(simState.plumeOpacity * 100)}%`;
            updateDailyDay();
        }
        setTimeout(() => map.invalidateSize(), 50);
    }

    function parseCsv(text) {
        const rows = [];
        let row = [];
        let field = '';
        let quoted = false;
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (quoted) {
                if (char === '"' && text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else if (char === '"') {
                    quoted = false;
                } else {
                    field += char;
                }
            } else if (char === '"' && field.length === 0) {
                quoted = true;
            } else if (char === ',') {
                row.push(field);
                field = '';
            } else if (char === '\n' || char === '\r') {
                if (char === '\r' && text[i + 1] === '\n') i++;
                row.push(field);
                if (row.some(value => value.trim() !== '')) rows.push(row);
                row = [];
                field = '';
            } else {
                field += char;
            }
        }
        row.push(field);
        if (row.some(value => value.trim() !== '')) rows.push(row);
        return rows;
    }

    function csvHeaderIndex(headers, candidates) {
        return headers.findIndex(header => candidates.includes(header.trim().toLowerCase()));
    }

    function importFirmsCsv(text, fileName) {
        if (!parentFeaturesByCode.size) throw new Error('Batas BIG belum selesai dimuat; coba impor kembali sebentar lagi.');
        const rows = parseCsv(text);
        if (rows.length < 2) throw new Error('CSV tidak memiliki baris data.');
        const headers = rows[0].map((header, index) => (index === 0 ? header.replace(/^\uFEFF/, '') : header).trim().toLowerCase());
        const columns = {
            lat: csvHeaderIndex(headers, ['latitude', 'lat']),
            lng: csvHeaderIndex(headers, ['longitude', 'lon', 'long']),
            date: csvHeaderIndex(headers, ['acq_date', 'acquisition_date', 'date']),
            time: csvHeaderIndex(headers, ['acq_time', 'acquisition_time', 'time']),
            frp: csvHeaderIndex(headers, ['frp']),
            confidence: csvHeaderIndex(headers, ['confidence'])
        };
        if (columns.lat < 0 || columns.lng < 0 || columns.date < 0 || columns.time < 0) {
            throw new Error('Kolom wajib tidak lengkap. Diperlukan latitude, longitude, acq_date, dan acq_time.');
        }
        let accepted = 0;
        let outsideAoi = 0;
        let invalid = 0;
        let outOfPeriod = 0;
        let duplicates = 0;
        rows.slice(1).forEach(values => {
            const lat = Number(values[columns.lat]);
            const lng = Number(values[columns.lng]);
            const dateUtc = String(values[columns.date] || '').trim();
            const time = acquisitionDateWit(dateUtc, values[columns.time]);
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || !time) {
                invalid++;
                return;
            }
            if (dailyDateIndex(time.date) < 0) {
                outOfPeriod++;
                return;
            }
            const classification = classifyCoordinates(lat, lng);
            if (!classification) {
                outsideAoi++;
                return;
            }
            const frpValue = columns.frp >= 0 ? optionalNumber(values[columns.frp]) : null;
            const record = {
                lat,
                lng,
                frp: frpValue,
                confidence: columns.confidence >= 0 ? String(values[columns.confidence] || '').trim() : '',
                acqDateUtc: dateUtc,
                acqTimeUtc: normalizeAcquisitionTime(values[columns.time]).hhmm,
                witDate: time.date,
                parentCode: classification.parentCode,
                districtCode: classification.districtCode,
                sourceLabel: fileName
            };
            if (addDailyRecord(record)) accepted++;
            else duplicates++;
        });
        return { accepted, outsideAoi, invalid, outOfPeriod, duplicates };
    }

    async function loadDailyHotspots() {
        const status = document.getElementById('daily-auto-source-status');
        try {
            const response = await fetch('data/harian/hotspots-firms.geojson');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
                throw new Error('GeoJSON bukan FeatureCollection yang valid.');
            }
            data.features.forEach(feature => {
                const properties = feature.properties || {};
                const coordinates = feature.geometry && feature.geometry.coordinates;
                if (!Array.isArray(coordinates) || coordinates.length < 2) return;
                const lng = Number(coordinates[0]);
                const lat = Number(coordinates[1]);
                const acqDateUtc = String(properties.acq_date || '');
                const time = acquisitionDateWit(acqDateUtc, properties.acq_time);
                const parentCode = String(properties.parent_code || '');
                if (!Number.isFinite(lat) || !Number.isFinite(lng) || !time ||
                    !['96.01', '96.71'].includes(parentCode) || dailyDateIndex(time.date) < 0) return;
                const classification = classifyCoordinates(lat, lng);
                if (!classification || classification.parentCode !== parentCode) return;
                addDailyRecord({
                    lat,
                    lng,
                    frp: optionalNumber(properties.frp),
                    confidence: String(properties.confidence || ''),
                    acqDateUtc,
                    acqTimeUtc: normalizeAcquisitionTime(properties.acq_time).hhmm,
                    witDate: time.date,
                    parentCode,
                    districtCode: classification.districtCode,
                    sourceLabel: 'Titik_Panas_PBD_Wilayah.gpkg'
                });
            });
            dailySourceLabel = 'Titik_Panas_PBD_Wilayah.gpkg (turunan terfilter dalam AOI BIG)';
            const datesWithData = new Set(dailyRecords.map(record => record.witDate));
            status.textContent = `${dailyRecords.length} rekaman dalam AOI pada ${datesWithData.size}/25 hari. Cakupan hari tanpa rekaman tidak diketahui.`;
            document.getElementById('daily-import-status').textContent = 'Sumber otomatis: Titik_Panas_PBD_Wilayah.gpkg; UTC dikonversi ke WIT. Impor CSV yang sama tidak menggandakan titik.';
            document.getElementById('daily-summary-source').textContent = dailySourceLabel;
            updateDailyDay();
        } catch (error) {
            status.textContent = `Data hotspot otomatis belum tersedia (${error.message}); gunakan impor CSV FIRMS.`;
            dailySourceLabel = 'Data hotspot belum tersedia';
        }
    }

    // 7. EVENT LISTENERS UI & INTERAKSI
    // Helper Toast
    let toastTimeout;
    function showToast(msg) {
        const el = document.getElementById('toast-msg');
        document.getElementById('toast-text').textContent = msg;
        el.classList.remove('hidden');
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => el.classList.add('hidden'), 2600);
    }

    // Toggle Sidebars
    document.getElementById('toggle-left-sidebar').addEventListener('click', () => {
        document.getElementById('left-sidebar').classList.toggle('hidden');
        setTimeout(() => map.invalidateSize(), 310);
    });

    document.getElementById('toggle-right-sidebar').addEventListener('click', () => {
        const rs = document.getElementById('right-sidebar');
        rs.classList.toggle('hidden');
        rs.classList.toggle('flex');
        setTimeout(() => map.invalidateSize(), 310);
    });
    document.getElementById('close-right-sidebar').addEventListener('click', () => {
        const rs = document.getElementById('right-sidebar');
        rs.classList.add('hidden');
        rs.classList.remove('flex');
    });

    // Tabs Switcher (Left Sidebar)
    const tabBtnLayers = document.getElementById('tab-btn-layers');
    const tabBtnSim = document.getElementById('tab-btn-sim');
    const tabContentLayers = document.getElementById('tab-content-layers');
    const tabContentSim = document.getElementById('tab-content-sim');

    tabBtnLayers.addEventListener('click', () => {
        tabBtnLayers.className = 'tab-btn active py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 bg-teal-600 text-white shadow';
        tabBtnSim.className = 'tab-btn py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition';
        tabContentLayers.classList.remove('hidden');
        tabContentSim.classList.add('hidden');
    });

    tabBtnSim.addEventListener('click', () => {
        tabBtnSim.className = 'tab-btn active py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 bg-teal-600 text-white shadow';
        tabBtnLayers.className = 'tab-btn py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition';
        tabContentSim.classList.remove('hidden');
        tabContentLayers.classList.add('hidden');
    });

    // Layer Visibility Checkboxes
    const layerCheckboxes = {
        'layer-hotspots': layerGroups.hotspots,
        'layer-burned': layerGroups.burned,
        'layer-wind': layerGroups.wind,
        'layer-plume': layerGroups.plume,
        'layer-aod': layerGroups.aod,
        'layer-admin-parents': layerGroups.adminParents,
        'layer-facilities': layerGroups.facilities
    };

    Object.entries(layerCheckboxes).forEach(([id, group]) => {
        document.getElementById(id).addEventListener('change', (e) => {
            if (isDailyMode) {
                if (id === 'layer-hotspots') {
                    dailyHotspotsToggle.checked = e.target.checked;
                    if (e.target.checked) map.addLayer(layerGroups.dailyHotspots);
                    else map.removeLayer(layerGroups.dailyHotspots);
                    return;
                }
                if (id === 'layer-plume') {
                    dailySmokeToggle.checked = e.target.checked;
                    if (e.target.checked && dailySmokeMethod.value === 'simulation') map.addLayer(layerGroups.dailySmoke);
                    else map.removeLayer(layerGroups.dailySmoke);
                    updateDailyDay();
                    return;
                }
                if (id === 'layer-facilities') {
                    if (e.target.checked) map.addLayer(layerGroups.dailyFacilities);
                    else map.removeLayer(layerGroups.dailyFacilities);
                    return;
                }
                if (id !== 'layer-admin-parents') return;
            }
            if (e.target.checked) map.addLayer(group);
            else map.removeLayer(group);
        });
    });

    districtLayerCheckbox.addEventListener('change', updateDistrictLayerVisibility);

    // Opacity Slider
    document.getElementById('plume-opacity-slider').addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        simState.plumeOpacity = val / 100;
        document.getElementById('plume-opacity-val').textContent = `${val}%`;
        renderAllLayers();
        if (isDailyMode) updateDailyDay();
    });

    dailyOpacitySlider.addEventListener('input', e => {
        const val = parseInt(e.target.value);
        simState.plumeOpacity = val / 100;
        document.getElementById('daily-opacity-value').textContent = `${val}%`;
        document.getElementById('plume-opacity-slider').value = val;
        document.getElementById('plume-opacity-val').textContent = `${val}%`;
        updateDailyDay();
    });

    dailySmokeMethod.addEventListener('change', updateDailyDay);
    dailySmokeToggle.addEventListener('change', () => {
        document.getElementById('layer-plume').checked = dailySmokeToggle.checked;
        updateDailyDay();
    });
    dailyHotspotsToggle.addEventListener('change', () => {
        document.getElementById('layer-hotspots').checked = dailyHotspotsToggle.checked;
        if (dailyHotspotsToggle.checked) map.addLayer(layerGroups.dailyHotspots);
        else map.removeLayer(layerGroups.dailyHotspots);
    });
    document.getElementById('layer-hotspots').addEventListener('change', e => {
        dailyHotspotsToggle.checked = e.target.checked;
    });
    document.getElementById('layer-plume').addEventListener('change', e => {
        dailySmokeToggle.checked = e.target.checked;
    });

    // Simulasi On-the-Fly Sliders
    function getCompassLabel(deg) {
        const dirs = ['Utara', 'Timur Laut', 'Timur', 'Tenggara', 'Selatan', 'Barat Daya', 'Barat', 'Barat Laut'];
        return dirs[Math.round(deg / 45) % 8];
    }

    document.getElementById('sim-wind-dir').addEventListener('input', (e) => {
        simState.windDir = parseInt(e.target.value);
        document.getElementById('wind-dir-display').textContent = `${simState.windDir}° (${getCompassLabel(simState.windDir)})`;
        renderAllLayers();
        if (isDailyMode) updateDailyDay();
    });

    document.getElementById('sim-wind-speed').addEventListener('input', (e) => {
        simState.windSpeed = parseFloat(e.target.value);
        document.getElementById('wind-speed-display').textContent = `${simState.windSpeed.toFixed(1)} m/s`;
        renderAllLayers();
        if (isDailyMode) updateDailyDay();
    });

    document.getElementById('sim-frp-mult').addEventListener('input', (e) => {
        simState.frpMult = parseFloat(e.target.value);
        document.getElementById('frp-mult-display').textContent = `${simState.frpMult.toFixed(1)}x`;
        renderAllLayers();
        if (isDailyMode) updateDailyDay();
    });

    // Tambah Titik Api via Klik Peta
    map.on('click', (e) => {
        const addMode = document.getElementById('add-fire-mode').checked;
        if (!addMode || isDailyMode) return;

        const newId = `HS-SIM-${hotspots.length + 1}`;
        hotspots.push({
            id: newId,
            lat: e.latlng.lat,
            lng: e.latlng.lng,
            frp: 60.0,
            conf: 'Simulasi',
            land: 'Titik Sumber Hipotetis Pengguna'
        });
        renderAllLayers();
        showToast(`Titik api ${newId} ditambahkan & plume dihitung ulang!`);
    });

    // Reset Simulasi
    document.getElementById('reset-sim-btn').addEventListener('click', () => {
        hotspots = JSON.parse(JSON.stringify(initialHotspots));
        simState.windDir = 315;
        simState.windSpeed = 6.5;
        simState.frpMult = 1.0;

        document.getElementById('sim-wind-dir').value = 315;
        document.getElementById('wind-dir-display').textContent = '315° (Barat Laut)';
        document.getElementById('sim-wind-speed').value = 6.5;
        document.getElementById('wind-speed-display').textContent = '6.5 m/s';
        document.getElementById('sim-frp-mult').value = 1.0;
        document.getElementById('frp-mult-display').textContent = '1.0x (Normal)';
        document.getElementById('add-fire-mode').checked = false;

        renderAllLayers();
        if (isDailyMode) updateDailyDay();
        showToast('Parameter simulasi dikembalikan ke kondisi awal.');
    });

    function focusFeatures(features, bounds, label, districtCode) {
        layerGroups.regionFocus.clearLayers();
        districtLabelsByCode.forEach((tooltip, code) => {
            const feature = districtFeaturesByCode.get(code);
            tooltip.setContent(feature.properties.WADMKC);
        });
        const selected = L.geoJSON({ type: 'FeatureCollection', features }, {
            pane: 'focusHaloPane',
            interactive: false,
            style: { color: '#291e25', weight: 8, opacity: 0.95, fillOpacity: 0 }
        });
        layerGroups.regionFocus.addLayer(selected);
        layerGroups.regionFocus.addLayer(L.geoJSON({ type: 'FeatureCollection', features }, {
            pane: 'focusPane',
            interactive: false,
            style: { color: '#f6b469', weight: 4, opacity: 1, fillColor: '#f6b469', fillOpacity: 0.08 }
        }));

        if (districtCode) {
            const feature = districtFeaturesByCode.get(districtCode);
            const tooltip = districtLabelsByCode.get(districtCode);
            if (districtLayerCheckbox.checked && tooltip) {
                tooltip.setContent(label);
            } else {
                addAdminLabel(layerGroups.regionFocus, feature.properties.label_point, label, 'admin-focus-label');
            }
        } else if (!parentLayerCheckbox.checked) {
            const feature = features[0];
            addAdminLabel(layerGroups.regionFocus, feature.properties.label_point, label.toUpperCase(), 'admin-focus-label');
        }

        map.fitBounds(bounds, { padding: [40, 40], maxZoom: districtCode ? 13 : 11 });
    }

    regionFilter.addEventListener('change', (e) => {
        const value = e.target.value;
        if (value === 'all') {
            layerGroups.regionFocus.clearLayers();
            if (aoiBounds) map.fitBounds(aoiBounds, { padding: [36, 36], maxZoom: 11 });
            updateDistrictLayerVisibility();
            return;
        }
        if (value === 'kota_sorong' || value === 'kabupaten_sorong') {
            const code = value === 'kota_sorong' ? '96.71' : '96.01';
            const feature = parentFeaturesByCode.get(code);
            const bounds = parentBoundsByCode.get(code);
            if (feature && bounds) focusFeatures(
                [feature],
                bounds,
                feature.properties.display_name,
                null
            );
            return;
        }
        if (value.indexOf('district:') === 0) {
            const code = value.slice('district:'.length);
            const feature = districtFeaturesByCode.get(code);
            const bounds = districtBoundsByCode.get(code);
            if (!feature || !bounds) {
                setAdminStatus(districtStatus, 'Batas distrik untuk pilihan ini belum tersedia.', true);
                return;
            }
            const parentName = feature.properties.KDPKAB === '96.71' ? 'Kota Sorong' : 'Kabupaten Sorong';
            focusFeatures([feature], bounds, `Distrik ${feature.properties.WADMKC} · ${parentName}`, code);
            updateDistrictLayerVisibility();
        }
    });

    regionFilter.addEventListener('change', () => {
        if (isDailyMode) updateDailyDay();
    });

    appModeSelect.addEventListener('change', () => setDailyMode(appModeSelect.value === 'daily'));
    document.getElementById('daily-prev-btn').addEventListener('click', () => {
        stopDailyPlayback();
        setDailyIndex(dailyCurrentIndex - 1);
    });
    document.getElementById('daily-next-btn').addEventListener('click', () => {
        stopDailyPlayback();
        setDailyIndex(dailyCurrentIndex + 1);
    });
    dailyPlayButton.addEventListener('click', startDailyPlayback);
    dailyDateSlider.addEventListener('input', e => {
        stopDailyPlayback();
        setDailyIndex(e.target.value);
    });
    dailyDatePicker.addEventListener('change', e => {
        stopDailyPlayback();
        const index = dailyDateIndex(e.target.value);
        if (index >= 0) setDailyIndex(index);
        else e.target.value = dailyDates[dailyCurrentIndex];
    });
    document.getElementById('daily-import-btn').addEventListener('click', () => {
        document.getElementById('daily-import-file').click();
    });
    document.getElementById('daily-import-file').addEventListener('change', async e => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const status = document.getElementById('daily-import-status');
        status.textContent = `Memeriksa ${file.name}…`;
        try {
            const text = await file.text();
            let digest = null;
            if (window.crypto && window.crypto.subtle && window.TextEncoder) {
                const bytes = new TextEncoder().encode(text);
                const hash = await window.crypto.subtle.digest('SHA-256', bytes);
                digest = Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, '0')).join('');
            }
            if (digest && importedFileHashes.has(digest)) {
                status.textContent = `${file.name} sudah pernah diimpor; tidak ada rekaman yang ditambahkan.`;
                return;
            }
            const result = importFirmsCsv(text, file.name);
            if (digest) importedFileHashes.add(digest);
            dailySourceLabel = `${dailySourceLabel}; CSV ${file.name}`;
            document.getElementById('daily-auto-source-status').textContent =
                `${dailyRecords.length} rekaman hotspot dalam AOI setelah impor. Cakupan pengamatan tetap tidak diketahui.`;
            status.textContent = `${result.accepted} rekaman baru; ${result.duplicates} duplikat; ${result.outsideAoi} di luar AOI; ${result.outOfPeriod} di luar periode; ${result.invalid} baris tidak valid.`;
            updateDailyDay();
        } catch (error) {
            status.textContent = `Impor gagal: ${error.message}`;
            showToast(`Impor CSV gagal: ${error.message}`);
        } finally {
            e.target.value = '';
        }
    });
    document.getElementById('daily-export-btn').addEventListener('click', () => {
        const dateText = dailyDates[dailyCurrentIndex];
        const features = recordsForDate(dateText).filter(recordMatchesCurrentRegion).map(record => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [record.lng, record.lat] },
            properties: {
                tanggal_wit: record.witDate,
                tanggal_akuisisi_utc: record.acqDateUtc,
                waktu_akuisisi_utc_hhmm: record.acqTimeUtc,
                wilayah_kode_big: record.parentCode,
                wilayah: parentRegionName(record.parentCode),
                distrik_kode_big: record.districtCode,
                frp: record.frp,
                satuan_frp: 'tidak tercatat di metadata lokal',
                confidence: record.confidence || null,
                sumber: record.sourceLabel
            }
        }));
        if (!features.length) return;
        const collection = {
            type: 'FeatureCollection',
            name: `Hotspot FIRMS ${dateText} WIT`,
            features
        };
        const blob = new Blob([JSON.stringify(collection, null, 2)], { type: 'application/geo+json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        const region = regionFilter.value.replace(/[^a-z0-9-]+/gi, '_');
        anchor.href = url;
        anchor.download = `hotspot_firms_${dateText}_${region}.geojson`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    });

    document.getElementById('focus-aoi-btn').addEventListener('click', () => {
        if (!aoiBounds) {
            setAdminStatus(parentStatus, 'Batas administrasi belum tersedia.', true);
            return;
        }
        regionFilter.value = 'all';
        layerGroups.regionFocus.clearLayers();
        updateDistrictLayerVisibility();
        map.fitBounds(aoiBounds, { padding: [36, 36], maxZoom: 11 });
    });

    // Time-Slider & Play Animation
    const timeScenarios = window.dataSkenario.timeScenarios;

    const timeSlider = document.getElementById('time-slider');
    timeSlider.max = timeScenarios.length - 1;
    timeSlider.value = Math.min(3, timeScenarios.length - 1);
    function applyTimeStep(idx) {
        const sc = timeScenarios[idx];
        document.getElementById('time-label').textContent = sc.label;
        simState.windDir = sc.dir;
        simState.windSpeed = sc.speed;
        simState.frpMult = sc.frp;

        document.getElementById('sim-wind-dir').value = sc.dir;
        document.getElementById('wind-dir-display').textContent = `${sc.dir}° (${getCompassLabel(sc.dir)})`;
        document.getElementById('sim-wind-speed').value = sc.speed;
        document.getElementById('wind-speed-display').textContent = `${sc.speed.toFixed(1)} m/s`;
        document.getElementById('sim-frp-mult').value = sc.frp;
        document.getElementById('frp-mult-display').textContent = `${sc.frp.toFixed(1)}x`;

        renderAllLayers();
    }

    timeSlider.addEventListener('input', (e) => applyTimeStep(parseInt(e.target.value)));

    let playInterval = null;
    document.getElementById('play-time-btn').addEventListener('click', () => {
        const icon = document.getElementById('play-icon');
        if (playInterval) {
            clearInterval(playInterval);
            playInterval = null;
            icon.className = 'fas fa-play text-xs ml-0.5';
        } else {
            icon.className = 'fas fa-pause text-xs';
            playInterval = setInterval(() => {
                let next = (parseInt(timeSlider.value) + 1) % timeScenarios.length;
                timeSlider.value = next;
                applyTimeStep(next);
            }, 1800);
        }
    });

    // Export Hasil Model ke GeoJSON
    document.getElementById('export-geojson-btn').addEventListener('click', () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentPlumeGeoJSON, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `skenario_ilustratif_sorong_${Date.now()}.geojson`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        showToast('File GeoJSON hasil dispersi asap berhasil diunduh!');
    });

    // Modal Metodologi & Ketidakpastian
    const modal = document.getElementById('methodology-modal');
    document.getElementById('open-methodology-btn').addEventListener('click', () => modal.classList.remove('hidden'));
    document.getElementById('close-methodology-btn').addEventListener('click', () => modal.classList.add('hidden'));
    document.getElementById('close-methodology-btn-2').addEventListener('click', () => modal.classList.add('hidden'));

    // Render Pertama Kali
    applyTimeStep(Number(timeSlider.value));
});
