ID = '1wByQxdc-OPu4lAw9lZbVb0LyIK4nNQZQOktzKLai9Bc';
if (window['__debreviate']) {
  window['__debreviate'].main(ID);
} else {
  var script = document.createElement('script');
  script.async = true;
  script.src = 'http://192.168.1.64:8080/debreviate.js'
  script.addEventListener('load', function() {
    window['__debreviate'].main(ID)
  }, false);
  document.body.appendChild(script);
}
