<?
	include ("../db_connect.php");
	
	$id_capitolo = $_POST['id_capitolo'];
	$id_argomento = $_POST['id_argomento'];
	
	OpenConnection();

	$sql = "";
	$sql .= "UPDATE help_argomenti SET id_capitolo = ".$id_capitolo." ";
	$sql .= "WHERE id = ".$id_argomento;
	
	$query = mysql_query($sql);

	CloseConnection();		
?>

<html>
<head>
<title></title>
</head>

<body bgcolor="#000000">

<script language="javascript">
	window.opener.location = "gest_help.php";
	self.close();
</script>

</body>

</html>