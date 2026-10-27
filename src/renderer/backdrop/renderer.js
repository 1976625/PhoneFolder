'use strict';

window.phoneFolder.onBackdropInit((data) => {
  if (data && data.image) {
    document.body.style.backgroundImage = `url("${data.image}")`;
  }
});
