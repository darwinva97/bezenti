# Product

## Register

brand

## Users

Dueños de pequeñas y medianas empresas y emprendedores (es/en) que buscan una
agencia digital de un solo interlocutor: web, hosting, correo, SEO, marketing y
bots. Llegan desde búsqueda orgánica o recomendación, evaluando si confiar el
proyecto. Contexto: deciden rápido, comparan con otras agencias, valoran que el
equipo demuestre criterio técnico real, no solo promesas. Idioma y zona horaria
propios importan (trato cercano).

El **dashboard interno** (apps/dashboard) sirve a operadores de la propia
agencia; registro product, secundario.

## Product Purpose

Sitio público de la agencia **Bezenti**: convertir visitas en contactos
cualificados mostrando criterio (servicios con keyword+geo como landings,
portafolio que rankea, blog). Éxito = el visitante percibe solvencia técnica y
escribe por el formulario de contacto. El sitio es 100% estático (Astro SSG),
multiidioma con rutas traducidas y detección de idioma en el edge.

## Brand Personality

Confianza técnica, nítida. Tres palabras: **preciso, solvente, cercano.** Voz
directa y concreta (decimos qué hacemos literalmente, no buzzwords). La
interfaz debe inspirar "esta gente sabe lo que hace" mediante jerarquía fuerte,
detalle de ingeniería y restraint, sin gritar. Cercanía vía copy y trato, no vía
decoración.

## Anti-references

- **Plantilla SaaS genérica**: hero con gradiente morado, eyebrow en mayúsculas
  tracked sobre cada sección, marcadores numerados (01/02/03) como scaffolding,
  grids de tarjetas idénticas icono+título+texto repetidas sin fin.
- **Corporativo frío / sin alma**: stock azul, vacío sin intención, cero
  personalidad ni detalle artesanal.
- **Cream / beige editorial de IA**: el fondo arena/papel cálido que toda IA
  genera por defecto. El sitio es de base clara fría con tinte navy de marca.

## Design Principles

1. **Demuestra criterio, no lo afirmes.** Cada decisión visual (jerarquía,
   espaciado, contraste) debe leerse como competencia técnica. Practica lo que
   vende la agencia.
2. **Restraint con un acento que importa.** Sistema 60-30-10 ya establecido:
   neutros con tinte navy + azul de marca; mini-acentos (coral/ámbar/teal/verde)
   con uso puntual y deliberado, nunca decorativo.
3. **Concreto sobre genérico.** Copy que dice qué hace el producto; secciones
   con estructura propia, no plantilla repetida. Romper la monotonía de grids.
4. **Rápido y accesible por defecto.** Cero JS innecesario (islas solo donde
   aportan), contraste verificado, motion respetuoso con reduced-motion.
5. **Bilingüe de primera clase.** es/en igual de pulidos; el copy y el layout
   aguantan ambas longitudes de texto.

## Accessibility & Inclusion

WCAG 2.1 AA. Texto de cuerpo ≥4.5:1, texto grande ≥3:1 (verificar sobre fondos
tintados y oscuros del hero). Foco visible en toda interacción, navegación por
teclado, targets táctiles ≥44px. `prefers-reduced-motion` honrado en toda
animación. Imágenes decorativas con `alt=""`; informativas con alt real.
