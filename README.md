# Jara! — Gerçek Zamanlı Web Arama Motoru

Google tarzı bir arayüze sahip, **gerçek web araması** yapan modern bir arama motoru. [z-ai-web-dev-sdk](https://www.npmjs.com/package/z-ai-web-dev-sdk) altyapısını kullanarak canlı web sonuçları, görseller, AI özetleri ve sesli arama sunar.

## Özellikler

- **Gerçek Web Araması** — Canlı web sonuçları (başlık, snippet, favicon, tarih)
- **Görsel Arama** — Sorgunuza uygun gerçek görsel sonuçları
- **AI Özeti (AI Overview)** — Arama sonuçlarından üretilen yapay zekâ özeti
- **Sesli Arama** — Mikrofon ile konuşarak arama
- **Otomatik Tamamlama** — Yazarken gerçek zamanlı arama önerileri
- **Zaman Filtresi** — Son 1 gün / 1 hafta / 1 ay / 1 yıl filtreleri
- **Sayfalama** — Google benzeri sayfa numaralandırma
- **Sunucu Tarafı Önbellek** — Aynı sorgular için 10 dakikalık akıllı önbellek
- **Karanlık Mod** — next-themes ile tam tema desteği
- **Responsive Tasarım** — Mobil ve masaüstünde kusursuz görünüm

## Teknoloji Yığını

| Katman | Teknoloji |
| --- | --- |
| Framework | Next.js 16 (App Router) + React 19 |
| Dil | TypeScript 5 |
| Stil | Tailwind CSS 4 + shadcn/ui |
| Arama & AI | z-ai-web-dev-sdk (web_search, image_search, LLM, ASR) |
| Önbellek | Bellek içi (Node.js) |
| Paket Yöneticisi | Bun |

## Kurulum

```bash
# 1. Bağımlılıkları yükleyin
bun install

# 2. Ortam değişkenlerini ayarlayın
cp .env.example .env

# 3. (Opsiyonel) Veritabanı şemasını hazırlayın
bun run db:push

# 4. Geliştirme sunucusunu başlatın
bun run dev
```

Uygulama `http://localhost:3000` adresinde çalışacaktır.

## API Uçları

| Uç | Açıklama |
| --- | --- |
| `GET /api/search?q=&page=&time=` | Web araması (sayfalama + zaman filtresi) |
| `GET /api/images?q=` | Görsel araması |
| `POST /api/ai-overview` | Arama sonuçlarından AI özeti |
| `GET /api/suggest?q=` | Arama önerileri (otomatik tamamlama) |
| `POST /api/voice` | Sesli arama (ses → metin) |

## Dağıtım (Vercel vb.)

Proje iki katmanlı arama mimarisi kullanır:

| Ortam | Web Arama | Görsel Arama | Öneriler | AI Özeti | Sesli Arama |
| --- | --- | --- | --- | --- | --- |
| Z.ai sandbox | z-ai-sdk web_search | z-ai-sdk | LLM | LLM | ASR |
| **Vercel / her yer** | Brave* → Bing HTML → Bing RSS → DDG → Lite → Qwant → Mojeek → Bing Intl → **Wikipedia + Bing News + Google News karma sayfası** | DDG → Qwant → Wikimedia Commons | DDG → Qwant | Wikipedia özeti / sonuçlardan derlenen özet | Kullanılamaz* |

> \* İsteğe bağlı: [Brave Search API](https://api-dashboard.search.brave.com) ücretsiz anahtarı (ayda 2.000 sorgu) alıp Vercel ortam değişkeni `BRAVE_API_KEY` olarak eklerseniz web aramaları öncelikle Brave üzerinden yapılır — en yüksek kalite. Anahtar olmadan da anahtarsız zincir çalışır.
>
> \* AI özeti Z.ai SDK gerektirir; desteklenmeyen ortamlarda iki anahtarsız düşme devreye girer: sorguyla güçlü eşleşen bir Wikipedia maddesi varsa maddeden gerçek bir **Özet** kartı (+kaynak linki) üretilir; yoksa arama sonuçlarının en alakalı parçacıkları tek kartta derlenir. Hiçbiri mümkün değilse kart sessizce gizlenir.
>
> \* Anahtarsız zincirin Bing uçları (HTML + RSS) doğrudan makale URL'leri döndürür; beslemelere karışan kendine referanslı `bing.com/search` linkleri otomatik filtrelenir.
>
> \* **Alaka kapısı:** Bazı anahtarsız uçlar nadir sorgularda veri merkezli IP'lerden tamamen alakasız hazır sayfalar döndürebilir. Zincir, sağlayıcının sonuçlarını sorgu terimleriyle karşılaştırır; alakasızsa o sağlayıcıyı atlar.
>
> \* **Karma yedek sayfa:** Tüm web sağlayıcıları engellenirse (Vercel IP'lerinde olur) zincir çökmek yerine Wikipedia (yalnızca sorguyu içeren maddeler, en fazla 2) + Bing News + Google News sonuçlarını tek akışta birleştirir; aynı makale kopyaları ayıklanır ve haberler **en yeniden eskiye** sıralanır. Böylece tek bir eski haber beslemesinin tüm sayfayı işgal etmesi engellenir.
>
> \* **Teşhis:** `/api/search?q=...&debug=1` çağrısı hangi sağlayıcıların denendiğini, kaç sonuç döndüklerini ve alaka kapısına takılıp takılmadığını `attempts` alanında gösterir.

**Vercel'e yükleme:**

```bash
npm i -g vercel
vercel
```

veya GitHub'a pushladıktan sonra [vercel.com/new](https://vercel.com/new) üzerinden repoyu içe aktarın. Ek ortam değişkeni gerekmez — arama motoru anahtarsız zincire otomatik düşer.

## Deploy Paketi (zip)

`download/ara-arama-motoru.zip` dosyası `git archive` ile üretilir ve `.gitattributes` sayesinde **yalnızca uygulamayı** içerir: sandbox dosyaları (`skills/`, `tests/`, `examples/` vb.), ekran görüntüleri ve zip'in kendisi pakete girmez. Paketi kendiniz üretmek isterseniz:

```bash
git archive --format=zip --prefix=ara-arama-motoru/ HEAD -o download/ara-arama-motoru.zip
```

## GitHub'a Yükleme

```bash
git init
git add .
git commit -m "Jara! arama motoru - ilk sürüm"
git branch -M main
git remote add origin https://github.com/KULLANICI_ADIN/REPO_ADIN.git
git push -u origin main
```

> **Not:** `.env` ve `db/*.db` dosyaları `.gitignore` ile hariç tutulmuştır; gizli/yerel dosyalar depoya girmez.

## Lisans

MIT
