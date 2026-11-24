# Sumber batas wilayah kajian

## Dataset

- Penyedia: Badan Informasi Geospasial (BIG).
- Layanan: [BATAS_KABKOTA_AR](https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/BATAS_KABKOTA_AR/MapServer).
- Layer: `0` — Area Batas Wilayah Administrasi Kabupaten/Kota.
- Edisi pada metadata layanan: Geodatabase data batas wilayah administrasi nasional, Juni 2026.
- Sistem koordinat sumber dan keluaran: GCS WGS 1984 / EPSG:4326; GeoJSON menyimpan posisi dalam urutan longitude, latitude.
- Tanggal akses dan ekstraksi: 24 November 2026.
- Hak cipta/atribusi pada metadata layanan: Badan Informasi Geospasial.

## Pemilihan fitur

GeoJSON `aoi-sorong.geojson` berisi dua fitur sumber yang dipertahankan terpisah:

1. `Kota Sorong` — `NAMOBJ`/`WADMKK` = `Kota Sorong`, `TIPADM` = 5 (Kota), `KDPKAB` = `96.71`, `WADMPR` = `Papua Barat Daya`.
2. `Kabupaten Sorong` — nama objek sumber `Sorong`, `WADMKK` = `Sorong`, `TIPADM` = 4 (Kabupaten), `KDPKAB` = `96.01`, `WADMPR` = `Papua Barat Daya`. Label tampilan “Kabupaten Sorong” dibentuk dari tipe administrasi dan nama objek sumber.

Pemilihan menggunakan nama, tipe administrasi, provinsi, dan kode PUM kabupaten/kota; kode `96.02` (Sorong Selatan) tidak dipilih. Permintaan GeoJSON menggunakan endpoint query layer 0 dengan kondisi tersebut dan `outSR=4326`.
Properti tambahan `display_name` menyimpan nama lengkap untuk tampilan aplikasi, tanpa mengganti atribut nama asli BIG.

## Batas distrik

- Penyedia: Badan Informasi Geospasial (BIG).
- Layanan: [BATAS_KECAMATAN_AR](https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/BATAS_KECAMATAN_AR/MapServer).
- Layer: `0` — batas wilayah administrasi kecamatan/distrik.
- Edisi pada metadata layanan: Juni 2026.
- Tanggal akses dan ekstraksi: 24 November 2026.
- Sistem koordinat keluaran: GCS WGS 1984 / EPSG:4326; koordinat GeoJSON berurutan longitude, latitude.
- Pemilihan: `TIPADM = 3`, `WADMPR = 'Papua Barat Daya'`, dan `KDPKAB IN ('96.01', '96.71')`. `KDPKAB` membedakan Kabupaten Sorong (`96.01`) dari Kota Sorong (`96.71`); Sorong Selatan (`96.02`) tidak dipilih. `KDCPUM` dipertahankan sebagai kode unik distrik.
- Hasil yang disimpan: 39 fitur sumber dengan geometri asli, terdiri atas 29 fitur berkode induk `96.01` dan 10 fitur berkode induk `96.71`. Nama ditampilkan dari atribut `WADMKC`; Klamono terverifikasi sebagai `KDCPUM = 96.01.06`, induk `KDPKAB = 96.01`. Tidak ada poligon yang dibuat untuk wilayah yang tidak terdapat dalam hasil.
- Properti tambahan `display_name`, `parent_name`, dan `label_point` hanya membantu antarmuka. Titik label dihitung sebagai titik interior dari setiap geometri dan tidak mengubah geometri sumber.

Catatan lisensi layer distrik sama dengan layer kabupaten/kota: metadata yang diperiksa mengidentifikasi BIG sebagai penyedia, tetapi `licenseInfo` tidak menyatakan izin redistribusi WebGIS secara eksplisit. Konfirmasikan syarat penggunaan dengan BIG/Ina-Geoportal sebelum publikasi umum atau komersial.

## Izin dan atribusi

Metadata REST yang diperiksa mencantumkan BIG sebagai pemegang hak/penyedia (`copyrightText` dan `accessInformation`), menyediakan query publik (`allowOthersToQuery`) dan format GeoJSON. Namun, kolom `licenseInfo` pada metadata item layanan kosong; metadata yang diperiksa tidak menyatakan lisensi pakai ulang atau syarat redistribusi WebGIS secara eksplisit. Atribusi BIG dicantumkan di aplikasi, tetapi hal itu sendiri bukan pengganti izin. Sebelum menerbitkan WebGIS untuk umum atau penggunaan komersial, konfirmasikan syarat penggunaan/redistribusi dengan BIG atau Ina-Geoportal.

## URL yang digunakan

- Metadata layanan: <https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/BATAS_KABKOTA_AR/MapServer?f=pjson>
- Metadata layer dan definisi atribut: <https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/BATAS_KABKOTA_AR/MapServer/0?f=pjson>
- Metadata item (termasuk edisi dan informasi lisensi): <https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/BATAS_KABKOTA_AR/MapServer/info/iteminfo?f=pjson>
- Query fitur resmi: <https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/BATAS_KABKOTA_AR/MapServer/0/query>
- Parameter pemilihan query: kode PUM `96.71` (Kota Sorong) dan `96.01` (Kabupaten Sorong), dengan tipe administrasi dan provinsi sesuai atribut; keluaran `outSR=4326`, GeoJSON.
- Metadata layanan distrik: <https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/BATAS_KECAMATAN_AR/MapServer?f=pjson>
- Metadata layer distrik dan definisi atribut: <https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/BATAS_KECAMATAN_AR/MapServer/0?f=pjson>
- Metadata item distrik (termasuk edisi dan informasi lisensi): <https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/BATAS_KECAMATAN_AR/MapServer/info/iteminfo?f=pjson>
- Query fitur distrik BIG: <https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/BATAS_KECAMATAN_AR/MapServer/0/query>
- Parameter pemilihan query distrik: `where=TIPADM=3 AND KDPKAB IN ('96.01','96.71') AND WADMPR='Papua Barat Daya'`, `outSR=4326`, `f=geojson`.
- Ina-Geoportal: <https://tanahair.indonesia.go.id/portal-web/>
