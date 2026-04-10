# Trend Radar

Rettiwt-API kullanan, verdiğiniz X kullanıcı adlarının son tweetlerini tarayıp link içerenleri listeleyen responsive bir web uygulaması.

## Çalıştırma

1. `npm install`
2. Gerekirse `.env` oluşturup `API_KEY` değerini ekleyin.
3. `npm run dev`

Uygulama arayüzü Vite üzerinden, veri katmanı ise `server.mjs` üzerinden çalışır. Geliştirme sırasında Vite, `/api` isteklerini yerel sunucuya yönlendirir.

## Notlar

- Kullanıcı adlarını arayüzdeki çok satırlı alana girersiniz; backend bu liste için son 5, 10 veya 20 tweeti çeker.
- Sadece link içeren tweetler ekrana getirilir.
- `API_KEY` doğrudan `.env` dosyasından okunur.
- Arayüz; telefon, masaüstü ve TV ekranları için büyük kartlar ve geniş odak alanlarıyla tasarlanmıştır.