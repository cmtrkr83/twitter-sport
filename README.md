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

## Portainer Deploy

Bu repo Portainer Stack ile dogrudan deploy edilebilir.

Eklenen dosyalar:

- `Dockerfile.api`: Node API servisi (`server.mjs`) icin image.
- `Dockerfile.web`: Vite build + Nginx servis image.
- `nginx.conf`: Frontend ve `/api` reverse proxy ayari.
- `docker-compose.portainer.yml`: Portainer Stack dosyasi.

Portainer adimlari:

1. Bu repoyu sunucuya cekin (veya Portainer'da repository URL ile Stack olusturun).
2. `.env.example` dosyasini `.env` olarak kopyalayin ve `API_KEY` degerini girin.
3. Portainer > Stacks > Add stack.
4. Name: `twitter-search`.
5. Compose path/content olarak `docker-compose.portainer.yml` kullanin.
6. Deploy the stack.

Varsayilan erisim:

- Web UI: `http://SUNUCU_IP:8080`
- API health: `http://SUNUCU_IP:8080/api/health`