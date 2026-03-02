// RunbookAI — Interactive Features & Animations

// ========================================
// Mobile Menu
// ========================================

function toggleMobileMenu() {
  const menu = document.getElementById('mobile-menu');
  menu.classList.toggle('active');
}

// ========================================
// Copy to Clipboard
// ========================================

function copyToClipboard(button) {
  const textToCopy = button.getAttribute('data-copy');

  navigator.clipboard.writeText(textToCopy).then(() => {
    button.classList.add('copied');
    const originalHTML = button.innerHTML;

    button.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    `;

    setTimeout(() => {
      button.classList.remove('copied');
      button.innerHTML = originalHTML;
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}

// ========================================
// GSAP Animations
// ========================================

document.addEventListener('DOMContentLoaded', () => {
  initDesignPartnerForm();

  // Register GSAP plugins
  if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);
    initAnimations();
  } else {
    // Fallback: show everything if GSAP didn't load
    document.querySelectorAll('[data-reveal], [data-reveal-section], [data-hero-split]').forEach(el => {
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
  }

  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;

      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        const headerOffset = 80;
        const elementPosition = target.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });

        // Close mobile menu if open
        const menu = document.getElementById('mobile-menu');
        if (menu) menu.classList.remove('active');
      }
    });
  });

  // Close mobile menu on outside click
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('mobile-menu');
    const toggle = document.querySelector('.nav-mobile-toggle');

    if (menu && menu.classList.contains('active')) {
      if (!menu.contains(e.target) && !toggle.contains(e.target)) {
        menu.classList.remove('active');
      }
    }
  });

  // Keyboard: Escape to close mobile menu
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const menu = document.getElementById('mobile-menu');
      if (menu) menu.classList.remove('active');
    }
  });

  // Sidebar active state tracking (for docs page)
  const sidebarLinks = document.querySelectorAll('.sidebar-nav a');
  if (sidebarLinks.length > 0) {
    const sections = [];

    sidebarLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href && href.startsWith('#')) {
        const section = document.querySelector(href);
        if (section) {
          sections.push({ link, section, id: href });
        }
      }
    });

    function updateActiveLink() {
      const scrollPosition = window.scrollY + 120;
      let activeSection = null;

      sections.forEach(({ link, section }) => {
        const sectionTop = section.offsetTop;
        const sectionHeight = section.offsetHeight;

        if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
          activeSection = link;
        }
      });

      sidebarLinks.forEach(link => link.classList.remove('active'));

      if (activeSection) {
        activeSection.classList.add('active');
      } else if (sections.length > 0 && window.scrollY < sections[0].section.offsetTop) {
        sections[0].link.classList.add('active');
      }
    }

    window.addEventListener('scroll', updateActiveLink);
    updateActiveLink();
  }
});

function initDesignPartnerForm() {
  const form = document.getElementById('design-partner-form');
  if (!form) return;

  const status = document.getElementById('design-partner-status');

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const role = String(formData.get('role') || '').trim();
    const infraStack = String(formData.get('infraStack') || '').trim();
    const incidentPain = String(formData.get('incidentPain') || '').trim();
    const contact = String(formData.get('contact') || '').trim();

    const subjectRole = role || 'RunbookAI Design Partner';
    const subject = `RunbookAI Design Partner: ${subjectRole}`;
    const body = [
      'Design Partner Intake',
      '',
      `Role: ${role}`,
      `Infra stack: ${infraStack}`,
      `Incident pain: ${incidentPain}`,
      `Contact: ${contact}`,
      '',
      'Submitted from userunbook.ai'
    ].join('\n');

    const mailtoUrl = `mailto:design-partners@userunbook.ai?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    if (status) {
      status.textContent = 'Opening your email client...';
    }

    window.location.href = mailtoUrl;
  });
}

function initAnimations() {
  // Accessibility: skip all animations for reduced-motion users
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) {
    document.querySelectorAll('[data-reveal], [data-reveal-section], [data-hero-split]').forEach(el => {
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
    document.querySelectorAll('.hero-title .char').forEach(el => {
      el.style.opacity = '1';
    });
    return;
  }

  // --- Modular animation initializers ---
  initHeroSplitText();
  initCardSpotlight();
  initFlowProgress();
  initSpotlightTyping();
  initFlowCounters();
  initMagneticButtons();

  // Scroll-triggered reveals for sections
  const sectionReveals = document.querySelectorAll('[data-reveal-section]');
  sectionReveals.forEach((el) => {
    gsap.fromTo(el,
      { opacity: 0, y: 36 },
      {
        opacity: 1,
        y: 0,
        duration: 0.7,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: el,
          start: 'top 88%',
          once: true,
        }
      }
    );
  });

  // Nav background opacity on scroll
  const nav = document.querySelector('.nav');
  if (nav) {
    ScrollTrigger.create({
      start: 0,
      end: 100,
      onUpdate: (self) => {
        const opacity = 0.82 + (self.progress * 0.18);
        nav.style.background = `rgba(255, 255, 255, ${opacity})`;
      }
    });
  }
}

// ========================================
// Split Text Utility
// ========================================

function splitTextIntoChars(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  while (walker.nextNode()) {
    // Skip text inside .hero-title-accent (animated as a whole to preserve gradient)
    if (walker.currentNode.parentElement.closest('.hero-title-accent')) continue;
    textNodes.push(walker.currentNode);
  }

  textNodes.forEach(node => {
    const fragment = document.createDocumentFragment();
    const text = node.textContent;
    for (let i = 0; i < text.length; i++) {
      const span = document.createElement('span');
      span.className = 'char';
      span.textContent = text[i] === ' ' ? '\u00A0' : text[i];
      fragment.appendChild(span);
    }
    node.parentNode.replaceChild(fragment, node);
  });

  return element.querySelectorAll('.char');
}

// ========================================
// 1. Hero Split-Text Character Animation
// ========================================

function initHeroSplitText() {
  const heroTitle = document.querySelector('[data-hero-split]');
  if (!heroTitle) return;

  const accent = heroTitle.querySelector('.hero-title-accent');
  const chars = splitTextIntoChars(heroTitle);
  heroTitle.style.opacity = '1';

  // Hide accent span initially (animated as a whole to preserve gradient)
  if (accent) gsap.set(accent, { opacity: 0, y: 20 });

  const tl = gsap.timeline({ delay: 0.2 });

  tl.fromTo(chars,
    { opacity: 0, y: 20, rotateX: -40 },
    {
      opacity: 1,
      y: 0,
      rotateX: 0,
      duration: 0.5,
      stagger: 0.018,
      ease: 'power3.out',
    }
  );

  // Accent line fades up as a whole, preserving the gradient shimmer
  if (accent) {
    tl.to(accent, {
      opacity: 1,
      y: 0,
      duration: 0.6,
      ease: 'power3.out',
    }, '-=0.2');
  }

  // After title finishes, animate remaining hero elements
  const heroReveals = document.querySelectorAll('.hero [data-reveal]');
  tl.fromTo(heroReveals,
    { opacity: 0, y: 28 },
    {
      opacity: 1,
      y: 0,
      duration: 0.8,
      stagger: 0.1,
      ease: 'power3.out',
    },
    '-=0.3'
  );
}

// ========================================
// 4. Capability Cards Mouse-Tracking Spotlight
// ========================================

function initCardSpotlight() {
  const cards = document.querySelectorAll('.cap-card');
  cards.forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty('--spotlight-x', x + 'px');
      card.style.setProperty('--spotlight-y', y + 'px');
    });
  });
}

// ========================================
// 5. How It Works Scroll-Connected Progress
// ========================================

function initFlowProgress() {
  const wrapper = document.querySelector('.flow-wrapper');
  const track = document.querySelector('.flow-progress-track');
  const fill = document.querySelector('.flow-progress-fill');
  if (!wrapper || !track || !fill) return;

  // Only on desktop (horizontal layout)
  if (window.innerWidth <= 768) return;

  const steps = wrapper.querySelectorAll('.flow-step');
  if (steps.length < 2) return;

  function positionTrack() {
    const firstNum = steps[0].querySelector('.flow-num');
    const lastNum = steps[steps.length - 1].querySelector('.flow-num');
    if (!firstNum || !lastNum) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const firstRect = firstNum.getBoundingClientRect();
    const lastRect = lastNum.getBoundingClientRect();

    const left = firstRect.left + firstRect.width / 2 - wrapperRect.left;
    const right = lastRect.left + lastRect.width / 2 - wrapperRect.left;

    track.style.left = left + 'px';
    track.style.width = (right - left) + 'px';
  }

  positionTrack();
  window.addEventListener('resize', positionTrack);

  gsap.to(fill, {
    width: '100%',
    ease: 'none',
    scrollTrigger: {
      trigger: wrapper,
      start: 'top 70%',
      end: 'bottom 50%',
      scrub: 0.5,
    }
  });
}

// ========================================
// 6. Spotlight Terminal Typing Effect
// ========================================

function initSpotlightTyping() {
  const terminal = document.querySelector('.spotlight-terminal-body');
  if (!terminal) return;

  const lines = terminal.children;
  if (lines.length === 0) return;

  gsap.set(lines, { opacity: 0, x: -12 });

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: terminal,
      start: 'top 80%',
      once: true,
    }
  });

  Array.from(lines).forEach((line, i) => {
    tl.to(line, {
      opacity: 1,
      x: 0,
      duration: 0.4,
      ease: 'power2.out',
    }, i * 0.15);
  });
}

// ========================================
// 7. Counter Animation on Flow Step Numbers
// ========================================

function initFlowCounters() {
  const counters = document.querySelectorAll('.flow-num[data-count]');
  counters.forEach(counter => {
    const target = parseInt(counter.getAttribute('data-count'), 10);
    counter.textContent = '0';

    ScrollTrigger.create({
      trigger: counter,
      start: 'top 85%',
      once: true,
      onEnter: () => {
        const obj = { val: 0 };
        gsap.to(obj, {
          val: target,
          duration: 0.8,
          ease: 'power2.out',
          onUpdate: () => {
            counter.textContent = Math.round(obj.val);
          }
        });
      }
    });
  });
}

// ========================================
// 8. Magnetic Button Effect
// ========================================

function initMagneticButtons() {
  const buttons = document.querySelectorAll('.btn-primary');
  const strength = 0.3;

  buttons.forEach(btn => {
    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      gsap.to(btn, {
        x: x * strength,
        y: y * strength,
        duration: 0.3,
        ease: 'power2.out',
      });
    });

    btn.addEventListener('mouseleave', () => {
      gsap.to(btn, {
        x: 0,
        y: 0,
        duration: 0.6,
        ease: 'elastic.out(1, 0.4)',
      });
    });
  });
}

// ========================================
// Syntax Highlighting (for docs page)
// ========================================

function highlightCode() {
  const configBlocks = document.querySelectorAll('.config-block');

  configBlocks.forEach(block => {
    const header = block.querySelector('.config-header');
    const codeEl = block.querySelector('pre code');
    if (!header || !codeEl) return;

    const headerText = header.textContent.toLowerCase();
    const code = codeEl.textContent;

    let highlighted;
    if (headerText.includes('terminal') || headerText.includes('.sh')) {
      highlighted = highlightBash(code);
    } else if (headerText.includes('.yaml') || headerText.includes('.yml') || headerText.includes('config')) {
      highlighted = highlightYaml(code);
    } else if (headerText.includes('.md')) {
      highlighted = highlightMarkdown(code);
    } else {
      highlighted = highlightBash(code);
    }

    codeEl.innerHTML = highlighted;
  });
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlightBash(code) {
  const lines = code.split('\n');
  return lines.map(line => {
    let escaped = escapeHtml(line);

    if (escaped.trim().startsWith('#')) {
      return `<span class="token-comment">${escaped}</span>`;
    }

    let result = escaped;

    result = result.replace(/"([^"\\]|\\.)*"/g, '<span class="token-string">$&</span>');
    result = result.replace(/'([^'\\]|\\.)*'/g, '<span class="token-string">$&</span>');
    result = result.replace(/\$\{[^}]+\}/g, '<span class="token-env">$&</span>');
    result = result.replace(/\$[A-Z_][A-Z0-9_]*/g, '<span class="token-env">$&</span>');
    result = result.replace(/\s(--?[a-zA-Z][-a-zA-Z0-9]*)/g, ' <span class="token-flag">$1</span>');

    const commands = ['git', 'bun', 'npm', 'runbook', 'cd', 'mkdir', 'cp', 'export', 'echo', 'curl', 'docker', 'kubectl', 'aws'];
    commands.forEach(cmd => {
      const regex = new RegExp(`^(${cmd})\\b`, 'g');
      result = result.replace(regex, '<span class="token-command">$1</span>');
    });

    result = result.replace(/(<span class="token-command">[^<]+<\/span>\s+)(run|dev|install|clone|status|add|commit|push|pull|ask|investigate|knowledge|slack-gateway)/g,
      '$1<span class="token-function">$2</span>');

    return result;
  }).join('\n');
}

function highlightYaml(code) {
  const lines = code.split('\n');
  return lines.map(line => {
    let escaped = escapeHtml(line);

    if (escaped.trim().startsWith('#')) {
      return `<span class="token-comment">${escaped}</span>`;
    }

    if (escaped.trim() === '') return escaped;

    let result = escaped;

    const keyMatch = result.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_-]*)(:)/);
    if (keyMatch) {
      const indent = keyMatch[1];
      const key = keyMatch[2];
      const colon = keyMatch[3];
      const rest = result.slice(keyMatch[0].length);

      let value = rest;
      value = value.replace(/"([^"\\]|\\.)*"/g, '<span class="token-string">$&</span>');
      value = value.replace(/'([^'\\]|\\.)*'/g, '<span class="token-string">$&</span>');
      value = value.replace(/\$\{[^}]+\}/g, '<span class="token-env">$&</span>');
      value = value.replace(/\b(true|false)\b/g, '<span class="token-keyword">$1</span>');
      value = value.replace(/\b(\d+)\b/g, '<span class="token-number">$1</span>');

      result = `${indent}<span class="token-yaml-key">${key}</span><span class="token-punctuation">${colon}</span>${value}`;
    }

    const arrayMatch = result.match(/^(\s*)(- )/);
    if (arrayMatch && !result.includes('token-yaml-key')) {
      const indent = arrayMatch[1];
      let rest = result.slice(arrayMatch[0].length);

      rest = rest.replace(/"([^"\\]|\\.)*"/g, '<span class="token-string">$&</span>');
      rest = rest.replace(/'([^'\\]|\\.)*'/g, '<span class="token-string">$&</span>');

      result = `${indent}<span class="token-list-marker">-</span> ${rest}`;
    }

    return result;
  }).join('\n');
}

function highlightMarkdown(code) {
  const lines = code.split('\n');
  let inFrontmatter = false;
  let frontmatterDelimiterCount = 0;

  return lines.map(line => {
    let escaped = escapeHtml(line);

    if (escaped.trim() === '---') {
      frontmatterDelimiterCount++;
      inFrontmatter = frontmatterDelimiterCount === 1;
      return `<span class="token-frontmatter">${escaped}</span>`;
    }

    if (inFrontmatter) {
      return highlightYaml(line);
    }

    if (escaped.match(/^#{1,6}\s/)) {
      return `<span class="token-heading">${escaped}</span>`;
    }

    if (escaped.match(/^\s*[-*]\s/)) {
      const match = escaped.match(/^(\s*)([-*])(\s)/);
      if (match) {
        return `${match[1]}<span class="token-list-marker">${match[2]}</span>${match[3]}${escaped.slice(match[0].length)}`;
      }
    }

    if (escaped.match(/^\s*\d+\.\s/)) {
      const match = escaped.match(/^(\s*)(\d+\.)(\s)/);
      if (match) {
        return `${match[1]}<span class="token-list-marker">${match[2]}</span>${match[3]}${escaped.slice(match[0].length)}`;
      }
    }

    escaped = escaped.replace(/`([^`]+)`/g, '<span class="token-string">`$1`</span>');

    return escaped;
  }).join('\n');
}

// Initialize syntax highlighting on page load
window.addEventListener('load', () => {
  highlightCode();
});
