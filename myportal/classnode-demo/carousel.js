const carousel = document.querySelector('.studio');
const slides = [...carousel.querySelectorAll('figure')];
const thumbnails = [...carousel.querySelectorAll('.carousel-rail li')];
const play = carousel.querySelector('.carousel-play');
let index = 0;
let timer;

function advance() {
  slides[index].hidden = true;
  thumbnails[index].classList.remove('is-active');
  index = (index + 1) % slides.length;
  slides[index].hidden = false;
  thumbnails[index].classList.add('is-active');
}

function setPlaying(playing) {
  clearInterval(timer);
  timer = playing ? setInterval(advance, 5500) : undefined;
  carousel.classList.toggle('is-playing', playing);
  play.textContent = playing ? '暂停轮播' : '继续轮播';
}

carousel.querySelector('.studio-view').addEventListener('focusin', () => setPlaying(false));
play.addEventListener('click', () => setPlaying(timer === undefined));
setPlaying(!matchMedia('(prefers-reduced-motion: reduce)').matches);
