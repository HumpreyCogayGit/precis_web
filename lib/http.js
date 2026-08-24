function allowMethods(req, res, methods = ['GET']) {
  if (methods.includes(req.method)) {
    return true;
  }

  res.setHeader('Allow', methods.join(', '));
  res.status(405).json({ error: `Method ${req.method} not allowed` });
  return false;
}

function sendServerError(res, message, err) {
  console.error(message, err);
  res.status(500).json({ error: message });
}

module.exports = {
  allowMethods,
  sendServerError,
};