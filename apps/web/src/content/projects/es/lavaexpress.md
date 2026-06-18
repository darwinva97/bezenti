---
locale: es
key: lavaexpress
category: web
image: /images/projects/lavaexpress-cover.jpg
cardImage: /images/projects/lavaexpress-card.jpg
imageAlt: "LavaExpress Lavandería"
slug: lavaexpress-lavanderia
title: "LavaExpress Lavandería"
description: "Plataforma para servicio de lavandería con precios, proceso de recojo a domicilio y reservas por WhatsApp."
client: "LavaExpress"
year: 2026
featured: false
url: https://lavanderia-dfj.pages.dev
topics: [bots, automation]
services: [web-design, bots, automation]
results:
  # ⚠️ MÉTRICAS DE EJEMPLO — sustituye por datos reales del cliente.
  - { value: "+52%", label: "reservas por WhatsApp" }
  - { value: "×3", label: "recojos automatizados" }
  - { value: "< 2 min", label: "tiempo de respuesta" }
---

LavaExpress es una lavandería de barrio con recojo y entrega a domicilio. Recibían pedidos por teléfono y mensajes sueltos, y se les escapaban turnos. Necesitaban una web que mostrara precios claros y dejara reservar sin llamadas.

## El reto

El negocio dependía de WhatsApp, pero todo era manual: el cliente preguntaba precio, alguien respondía cuando podía, se acordaba una hora y a veces se perdía la cita. Sin agenda clara, los recojos chocaban entre sí y la respuesta tardía hacía que el cliente se fuera a la competencia.

## Qué hicimos

Diseñamos y construimos la web, y le sumamos un bot de WhatsApp que ordena las reservas.

- Página de precios por tipo de prenda y servicio, sin letra pequeña.
- Flujo de recojo a domicilio paso a paso: dirección, franja horaria y confirmación.
- Bot de WhatsApp que responde precios y agenda recojos sin intervención humana.
- Confirmaciones y recordatorios automáticos antes de cada recojo.
- Panel simple para ver las reservas del día y marcar entregas.
- Diseño responsive pensado para móvil, que es por donde llegan casi todos.

## Cómo lo construimos

Web estática y rápida servida desde CDN, con carga por debajo de un segundo en móvil. El bot se apoya en la API de WhatsApp y un flujo de automatización que conecta la conversación con la agenda: cuando un cliente confirma franja, se crea el recojo y se dispara el recordatorio. Validamos cada paso para que un mensaje incompleto no genere una reserva rota. Accesibilidad AA y SEO local para que "lavandería con recojo a domicilio" aparezca en su zona.

## Resultados

Las reservas por WhatsApp crecieron porque el cliente ya no espera a que alguien conteste: el bot responde al instante, de día y de noche. Los recojos se ordenaron en franjas y los recordatorios bajaron las ausencias. El tiempo de respuesta pasó de horas a menos de dos minutos.
