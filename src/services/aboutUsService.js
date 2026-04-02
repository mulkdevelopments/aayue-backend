// services/AboutUsService.js

module.exports.getAboutUs = async (client) => {
  const query = `SELECT * FROM about_us_page ORDER BY id ASC LIMIT 1`;
  const result = await client.query(query);
  return result.rows[0] || null;
};

module.exports.createAboutUs = async (data, client) => {
  const query = `
    INSERT INTO about_us_page (
      summary_heading, summary_subheading, summary_text, summary_banner,
      top_title, top_subtitle, top_text, top_image_url,
      middle_title, middle_subtitle, middle_text, middle_image_url,
      bottom_title, bottom_subtitle, bottom_text, bottom_image_url
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
    ) RETURNING *;
  `;

  const params = [
    data.summary_heading,
    data.summary_subheading,
    data.summary_text,
    data.summary_banner,
    data.top_title,
    data.top_subtitle,
    data.top_text,
    data.top_image_url,
    data.middle_title,
    data.middle_subtitle,
    data.middle_text,
    data.middle_image_url,
    data.bottom_title,
    data.bottom_subtitle,
    data.bottom_text,
    data.bottom_image_url,
  ];

  const result = await client.query(query, params);
  return result.rows[0];
};

module.exports.updateAboutUs = async (id, data, client) => {
  const query = `
    UPDATE about_us_page SET
      summary_heading=$1, summary_subheading=$2, summary_text=$3,
      summary_banner=$4,
      top_title=$5, top_subtitle=$6, top_text=$7, top_image_url=$8,
      middle_title=$9, middle_subtitle=$10, middle_text=$11, middle_image_url=$12,
      bottom_title=$13, bottom_subtitle=$14, bottom_text=$15, bottom_image_url=$16
    WHERE id=$17 RETURNING *;
  `;

  const params = [
    data.summary_heading,
    data.summary_subheading,
    data.summary_text,
    data.summary_banner,
    data.top_title,
    data.top_subtitle,
    data.top_text,
    data.top_image_url,
    data.middle_title,
    data.middle_subtitle,
    data.middle_text,
    data.middle_image_url,
    data.bottom_title,
    data.bottom_subtitle,
    data.bottom_text,
    data.bottom_image_url,
    id,
  ];

  const result = await client.query(query, params);
  return result.rows[0];
};
