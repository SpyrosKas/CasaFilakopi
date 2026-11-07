// The first import of the contact details, and the fallback if the database
// cannot be read. Yorgos edits them in Admin. The map stays here: it is not text.
export const contact = {
  email: "host@miloscasa.com",
  phoneDisplay: "(+30) 693-470-7765",
  phoneHref: "tel:+306934707765",
  whatsappDisplay: "00306934707765",
  whatsappHref: "https://wa.me/306934707765",
  facebook: "https://www.facebook.com/CasaFilakopi/",
  instagram: "https://www.instagram.com/casa_filakopi/",
  mapEmbed:
    "https://www.google.com/maps/embed?pb=!1m32!1m12!1m3!1d25578.548213303653!2d24.460092421045786!3d36.7389247674968!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!4m17!3e0!4m5!1s0x1498df40155a6acb%3A0x500bd2ce2bb1320!2zzpHOtM6szrzOsc-C!3m2!1d36.7252955!2d24.444758699999998!4m3!3m2!1d36.7492351!2d24.506630299999998!4m5!1s0x1498df92fe057e0f%3A0xcc48a1c875a049c7!2sCasa+Filakopi%2C+Eparchiaki+Odos+Triovasalou+-+Apollonion%2C+Milos!3m2!1d36.752533799999995!2d24.5104454!5e0!3m2!1sel!2sgr!4v1561484844728!5m2!1sel!2sgr",
  mapLink:
    "https://www.google.com/maps/search/?api=1&query=36.7525338%2C24.5104454",
} as const;
