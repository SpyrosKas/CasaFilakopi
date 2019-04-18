(function ($) {

  'use strict';

  $('.site-menu-toggle').click(function () {
    var $this = $(this);
    if ($('body').hasClass('menu-open')) {
      $this.removeClass('open');
      $('.js-site-navbar').fadeOut(400);
      $('body').removeClass('menu-open');
    } else {
      $this.addClass('open');
      $('.js-site-navbar').fadeIn(400);
      $('body').addClass('menu-open');
    }
  });


  $('nav .dropdown').hover(function () {
    var $this = $(this);
    $this.addClass('show');
    $this.find('> a').attr('aria-expanded', true);
    $this.find('.dropdown-menu').addClass('show');
  }, function () {
    var $this = $(this);
    $this.removeClass('show');
    $this.find('> a').attr('aria-expanded', false);
    $this.find('.dropdown-menu').removeClass('show');
  });



  $('#dropdown04').on('show.bs.dropdown', function () {
    console.log('show');
  });

  // aos
  AOS.init({
    duration: 1000
  });



  var contentWayPoint = function () {
    var i = 0;
    $('.element-animate').waypoint(function (direction) {

      if (direction === 'down' && !$(this.element).hasClass('element-animated')) {

        i++;

        $(this.element).addClass('item-animate');
        setTimeout(function () {

          $('body .element-animate.item-animate').each(function (k) {
            var el = $(this);
            setTimeout(function () {
              var effect = el.data('animate-effect');
              if (effect === 'fadeIn') {
                el.addClass('fadeIn element-animated');
              } else if (effect === 'fadeInLeft') {
                el.addClass('fadeInLeft element-animated');
              } else if (effect === 'fadeInRight') {
                el.addClass('fadeInRight element-animated');
              } else {
                el.addClass('fadeInUp element-animated');
              }
              el.removeClass('item-animate');
            }, k * 100);
          });

        }, 100);

      }

    }, {
      offset: '95%'
    });
  };
  contentWayPoint();



})(jQuery);