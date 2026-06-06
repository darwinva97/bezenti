---
locale: es
key: core-web-vitals
topics: [performance, seo]
category: web
image: /images/posts/core-web-vitals-cover.jpg
cardImage: /images/posts/core-web-vitals-card.jpg
imageAlt: "Panel de rendimiento web"
slug: core-web-vitals-guia
title: "Core Web Vitals: qué son y cómo aprobarlos"
description: "Largest Contentful Paint, Interaction to Next Paint y Cumulative Layout Shift, explicados claro y con soluciones que puedes aplicar."
pubDate: 2026-05-20
---

Google no espera a nadie, y tus clientes potenciales tampoco. Si tu web tarda más de tres segundos en mostrar el contenido o los botones se mueven de sitio mientras el usuario intenta hacer clic, estás perdiendo ventas. Google mide esta experiencia de usuario mediante las Core Web Vitals, un conjunto de métricas de rendimiento que influyen directamente en el posicionamiento SEO de tu negocio. No se trata de teoría abstracta: son factores técnicos medibles que determinan si tu web sube o baja en los resultados de búsqueda.

## Qué son las Core Web Vitals y cómo afectan a tu SEO

Las Core Web Vitals son tres indicadores específicos que Google utiliza para evaluar la velocidad, la capacidad de respuesta y la estabilidad visual de una página web. Desde hace tiempo, el buscador penaliza a los sitios lentos o inestables en sus resultados móviles y de escritorio.

Aprobar este examen no consiste en instalar un módulo genérico y olvidarse. Requiere optimizar el código, la configuración del servidor y la carga de los recursos visuales. Google analiza datos reales de usuarios que navegan por tu web (a través del informe Chrome UX Report) y los compara con unos límites estrictos. Si tu web no cumple con estos límites, tu visibilidad orgánica se reduce en favor de competidores que sí lo hacen.

## LCP (Largest Contentful Paint): Velocidad de carga visual

El LCP mide el tiempo que tarda en mostrarse en pantalla el elemento de contenido más grande, que suele ser una imagen de cabecera, un banner principal o un bloque de texto destacado. Para que Google considere que la velocidad de carga es buena, este elemento debe aparecer en menos de **2,5 segundos** desde que se inicia la carga de la página.

Si tu LCP es lento, el usuario percibe que la web no funciona y suele abandonarla antes de interactuar. Para corregir esta métrica en tu sitio web, debes aplicar medidas técnicas concretas:

*   **Comprimir y adaptar imágenes:** Usa formatos de última generación como WebP o AVIF y define tamaños específicos según el dispositivo del usuario para evitar descargar archivos más grandes de lo necesario.
*   **Priorizar la carga del elemento principal:** Utiliza el atributo de HTML `fetchpriority="high"` en la etiqueta de la imagen del banner de cabecera para que el navegador la descargue antes que el resto de elementos secundarios.
*   **Optimizar el servidor:** Configura un sistema de caché sólido a nivel de servidor y utiliza una red de entrega de contenido (CDN) para que los archivos se carguen rápido desde cualquier ubicación geográfica.

## INP (Interaction to Next Paint): Capacidad de respuesta

El INP es la métrica que sustituye oficialmente al antiguo indicador FID (First Input Delay). Mide la latencia de todas las interacciones que realiza un usuario en la página, como hacer clic en un enlace, abrir un menú desplegable o rellenar un formulario. Evalúa cuánto tarda la web en mostrar una respuesta visual tras esa acción. Un buen INP debe situarse por debajo de los **200 milisegundos**.

Cuando el INP falla, el usuario siente que la web se queda colgada o que los botones no funcionan. Las soluciones para mejorar la capacidad de respuesta incluyen:

*   **Reducir el tiempo de ejecución de JavaScript:** Minimiza los scripts innecesarios, elimina el código sobrante y pospone la carga de las funciones que no sean esenciales para el primer renderizado.
*   **Dividir tareas largas:** Si un script tarda más de 50 milisegundos en ejecutarse, bloquea el navegador y retrasa la respuesta al usuario. Dividir ese código en tareas más pequeñas permite que la web responda antes.
*   **Cargar scripts de terceros de forma diferida:** Retrasa la carga de herramientas de análisis, píxeles de seguimiento o chats de soporte hasta que la página principal esté totalmente operativa.

## CLS (Cumulative Layout Shift): Estabilidad visual

¿Alguna vez has ido a pulsar un botón en el móvil y, de repente, la página se ha movido hacia abajo y has acabado haciendo clic en un anuncio por error? Eso es un cambio de diseño inesperado, y el CLS se encarga de medirlo. La puntuación de CLS debe ser inferior a **0,1** para considerarse óptima.

Esta métrica no mide tiempo, sino la cantidad de movimiento de los elementos en la pantalla durante la fase de carga. Para solucionar los problemas de CLS en tu web:

*   **Reserva espacio para las imágenes:** Indica siempre los atributos de ancho y alto (`width` y `height`) en el código HTML de las imágenes y vídeos. De este modo, el navegador reserva ese espacio exacto antes de descargar el archivo.
*   **Evita insertar contenido dinámico arriba:** No coloques anuncios, banners informativos o avisos de cookies por encima del contenido que ya se ha cargado, a menos que sea en respuesta directa a una acción del usuario.
*   **Utiliza fuentes web optimizadas:** Asegúrate de que las tipografías personalizadas no provoquen saltos de línea ni cambios de tamaño bruscos cuando se sustituye la fuente por defecto del navegador.

## Cómo analizar el estado de tu web

Para saber si tu web aprueba o necesita mejoras, no necesitas adivinar. Existen herramientas gratuitas oficiales de Google que te muestran los datos exactos de rendimiento:

*   **Google Search Console:** En la sección "Métricas web principales" verás qué páginas de tu sitio están fallando en dispositivos móviles y ordenadores con datos reales de tus visitas.
*   **PageSpeed Insights:** Te ofrece un análisis detallado en tiempo real de cualquier URL concreta, desglosando el rendimiento y aportando un listado de tareas técnicas prioritarias para tus desarrolladores.

## Optimiza el rendimiento técnico de tu web

Aprobar las Core Web Vitals no es una cuestión de diseño visual, sino de arquitectura técnica. Una web rápida y estable retiene a más visitas, aumenta el porcentaje de conversión de tu negocio y mejora tu posición en Google frente a la competencia directa. 

Para lograr estos resultados se requiere código limpio, configuración avanzada de servidores y un mantenimiento constante de la plataforma. Si quieres que analicemos la velocidad de tu sitio web y eliminemos los bloqueos técnicos que frenan tus ventas, escríbenos a Bezenti. Nos encargamos de que tu infraestructura digital funcione con la precisión que tu negocio necesita.
